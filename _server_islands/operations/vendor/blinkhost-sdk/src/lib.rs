//! BlinkHost Rust SDK 1.1.0 for the `blinkhost-wasi-1` host ABI.
//!
//! Client bindings for WASI request, response and host services.

use std::env;

pub const SDK_VERSION: &str = "1.1.0";
pub const ABI_VERSION: &str = "blinkhost-wasi-1";

const IO_CHUNK_BYTES: usize = 64 * 1024;
const HOST_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    HostRejected,
    InvalidUtf8,
    InvalidJson,
    MissingSecret,
    LogRejected(i32),
}

#[link(wasm_import_module = "blinkhost_system")]
extern "C" {
    fn read_request(pointer: i32, offset: i32, capacity: i32) -> i32;
    fn write_response(pointer: i32, length: i32) -> i32;
    fn query_db_v2(
        binding_pointer: i32,
        binding_length: i32,
        request_pointer: i32,
        request_length: i32,
        output_pointer: i32,
        output_capacity: i32,
    ) -> i32;
    fn hash_argon2(
        input_pointer: i32,
        input_length: i32,
        output_pointer: i32,
        output_capacity: i32,
    ) -> i32;
    fn blinkhost_fetch(
        request_pointer: i32,
        request_length: i32,
        output_pointer: i32,
        output_capacity: i32,
    ) -> i32;
    fn log(pointer: i32, length: i32) -> i32;
    fn preview_blob(
        request_pointer: i32,
        request_length: i32,
        output_pointer: i32,
        output_capacity: i32,
    ) -> i32;
    fn preview_email(
        request_pointer: i32,
        request_length: i32,
        output_pointer: i32,
        output_capacity: i32,
    ) -> i32;
    fn object_storage(
        request_pointer: i32,
        request_length: i32,
        output_pointer: i32,
        output_capacity: i32,
    ) -> i32;
}

fn json_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0c}' => output.push_str("\\f"),
            value if value < '\u{20}' => {
                use std::fmt::Write;
                let _ = write!(output, "\\u{:04x}", value as u32);
            }
            value => output.push(value),
        }
    }
    output.push('"');
    output
}

fn env_value(name: &str) -> Option<String> {
    env::var(name).ok()
}

fn header_key(name: &str) -> String {
    let mut key = String::from("HTTP_REQ_");
    for character in name.chars() {
        if character == '-' {
            key.push('_');
        } else {
            key.extend(character.to_uppercase());
        }
    }
    key
}

pub struct Request {
    pub method: String,
    pub path: String,
    pub query: String,
    pub content_type: String,
    pub body: Vec<u8>,
}

impl Request {
    pub fn from_host() -> Result<Self, Error> {
        let mut body = Vec::new();
        loop {
            let offset = body.len();
            let mut chunk = vec![0_u8; IO_CHUNK_BYTES];
            let read = unsafe {
                read_request(chunk.as_mut_ptr() as i32, offset as i32, chunk.len() as i32)
            };
            if read < 0 || read as usize > chunk.len() {
                return Err(Error::HostRejected);
            }
            chunk.truncate(read as usize);
            body.extend_from_slice(&chunk);
            if read as usize != IO_CHUNK_BYTES {
                break;
            }
        }
        Ok(Self {
            method: env_value("REQUEST_METHOD").unwrap_or_default(),
            path: env_value("REQUEST_PATH").unwrap_or_default(),
            query: env_value("QUERY_STRING").unwrap_or_default(),
            content_type: env_value("CONTENT_TYPE").unwrap_or_default(),
            body,
        })
    }

    pub fn text(&self) -> Result<&str, Error> {
        std::str::from_utf8(&self.body).map_err(|_| Error::InvalidUtf8)
    }

    /// Returns the request body after UTF-8 validation. JSON decoding is left
    /// to the application's chosen vendored decoder.
    pub fn json(&self) -> Result<&str, Error> {
        let value = self.text()?;
        let trimmed = value.trim();
        if (trimmed.starts_with('{') && trimmed.ends_with('}'))
            || (trimmed.starts_with('[') && trimmed.ends_with(']'))
        {
            Ok(value)
        } else {
            Err(Error::InvalidJson)
        }
    }

    pub fn header(&self, name: &str) -> Option<String> {
        env_value(&header_key(name))
    }

    pub fn cookie(&self, name: &str) -> Option<String> {
        self.header("cookie").and_then(|header| {
            header.split(';').find_map(|pair| {
                let (key, value) = pair.trim().split_once('=')?;
                (key == name).then(|| value.to_string())
            })
        })
    }
}

pub struct Response {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Response {
    pub fn new(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: body.into(),
        }
    }

    pub fn json(status: u16, json: impl Into<String>) -> Self {
        Self::new(status, json).header("content-type", "application/json")
    }

    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    /// Adds a complete Set-Cookie value. The edge emits it only when the
    /// module's signed runtime policy permits cookies.
    pub fn set_cookie(self, value: impl Into<String>) -> Self {
        self.header("set-cookie", value)
    }

    fn encoded(&self) -> Vec<u8> {
        let headers = self
            .headers
            .iter()
            .map(|(name, value)| format!("{}:{}", json_string(name), json_string(value)))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{{\"status\":{},\"headers\":{{{}}},\"body\":{}}}",
            self.status,
            headers,
            json_string(&self.body)
        )
        .into_bytes()
    }
}

pub fn respond(response: Response) -> Result<(), Error> {
    let bytes = response.encoded();
    let written = unsafe { write_response(bytes.as_ptr() as i32, bytes.len() as i32) };
    if written == bytes.len() as i32 {
        Ok(())
    } else {
        Err(Error::HostRejected)
    }
}

pub fn secret(name: &str) -> Result<String, Error> {
    if name.is_empty()
        || name.starts_with("PUBLIC_")
        || name.starts_with("NEXT_PUBLIC_")
        || name.starts_with("HTTP_REQ_")
        || matches!(
            name,
            "REQUEST_METHOD" | "REQUEST_PATH" | "QUERY_STRING" | "CONTENT_TYPE" | "CLIENT_IP"
        )
    {
        return Err(Error::MissingSecret);
    }
    env_value(name).ok_or(Error::MissingSecret)
}

pub fn log_record(level: &str, message: &str, attributes: &[(&str, &str)]) -> Result<(), Error> {
    let attributes = attributes
        .iter()
        .map(|(name, value)| format!("{}:{}", json_string(name), json_string(value)))
        .collect::<Vec<_>>()
        .join(",");
    let payload = format!(
        "{{\"level\":{},\"message\":{},\"attributes\":{{{}}}}}",
        json_string(level),
        json_string(message),
        attributes
    );
    let status = unsafe { log(payload.as_ptr() as i32, payload.len() as i32) };
    if status == 0 {
        Ok(())
    } else {
        Err(Error::LogRejected(status))
    }
}

pub fn query(binding: &str, sql: &str, params_json: &str) -> Result<String, Error> {
    let params = params_json.trim();
    if !params.starts_with('[') || !params.ends_with(']') {
        return Err(Error::InvalidJson);
    }
    let request = format!("{{\"sql\":{},\"params\":{}}}", json_string(sql), params);
    let mut output = vec![0_u8; HOST_OUTPUT_BYTES];
    let written = unsafe {
        query_db_v2(
            binding.as_ptr() as i32,
            binding.len() as i32,
            request.as_ptr() as i32,
            request.len() as i32,
            output.as_mut_ptr() as i32,
            output.len() as i32,
        )
    };
    host_string(output, written)
}

pub fn hash_password(password: &str) -> Result<String, Error> {
    let mut output = vec![0_u8; 256];
    let written = unsafe {
        hash_argon2(
            password.as_ptr() as i32,
            password.len() as i32,
            output.as_mut_ptr() as i32,
            output.len() as i32,
        )
    };
    host_string(output, written)
}

pub fn fetch(
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> Result<String, Error> {
    let headers = headers
        .iter()
        .map(|(name, value)| format!("{}:{}", json_string(name), json_string(value)))
        .collect::<Vec<_>>()
        .join(",");
    let body = body.map(json_string).unwrap_or_else(|| "null".to_string());
    let request = format!(
        "{{\"method\":{},\"url\":{},\"headers\":{{{}}},\"body\":{}}}",
        json_string(method),
        json_string(url),
        headers,
        body
    );
    let mut output = vec![0_u8; HOST_OUTPUT_BYTES];
    let written = unsafe {
        blinkhost_fetch(
            request.as_ptr() as i32,
            request.len() as i32,
            output.as_mut_ptr() as i32,
            output.len() as i32,
        )
    };
    host_string(output, written)
}

pub fn preview_blob_put(key: &str, body: &[u8]) -> Result<String, Error> {
    preview_blob_call("put", key, Some(&base64_encode(body)))
}

pub fn preview_blob_get(key: &str) -> Result<String, Error> {
    preview_blob_call("get", key, None)
}

pub fn preview_blob_delete(key: &str) -> Result<String, Error> {
    preview_blob_call("delete", key, None)
}

fn preview_blob_call(
    operation: &str,
    key: &str,
    body_base64: Option<&str>,
) -> Result<String, Error> {
    let body = body_base64
        .map(json_string)
        .unwrap_or_else(|| "null".to_string());
    let request = format!(
        "{{\"operation\":{},\"key\":{},\"body_base64\":{}}}",
        json_string(operation),
        json_string(key),
        body,
    );
    let mut output = vec![0_u8; 400_000];
    let written = unsafe {
        preview_blob(
            request.as_ptr() as i32,
            request.len() as i32,
            output.as_mut_ptr() as i32,
            output.len() as i32,
        )
    };
    host_string(output, written)
}

pub fn preview_email_capture(
    recipient: &str,
    subject: &str,
    text_body: &str,
    html_body: &str,
) -> Result<String, Error> {
    let request = format!(
        "{{\"recipient\":{},\"subject\":{},\"text_body\":{},\"html_body\":{}}}",
        json_string(recipient),
        json_string(subject),
        json_string(text_body),
        json_string(html_body),
    );
    let mut output = vec![0_u8; 65_536];
    let written = unsafe {
        preview_email(
            request.as_ptr() as i32,
            request.len() as i32,
            output.as_mut_ptr() as i32,
            output.len() as i32,
        )
    };
    host_string(output, written)
}

/// Execute a Hosted Object Storage operation.
///
/// The request must be a JSON object using the documented v1 operation
/// contract. The returned JSON always includes either `data` or a stable
/// `error.code` plus `request_id` for support correlation.
pub fn object_storage_request(request_json: &str) -> Result<String, Error> {
    let request = request_json.trim();
    if !request.starts_with('{') || !request.ends_with('}') || request.len() > 64 * 1024 {
        return Err(Error::InvalidJson);
    }
    let mut output = vec![0_u8; HOST_OUTPUT_BYTES];
    let written = unsafe {
        object_storage(
            request.as_ptr() as i32,
            request.len() as i32,
            output.as_mut_ptr() as i32,
            output.len() as i32,
        )
    };
    host_string(output, written)
}

fn base64_encode(value: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(value.len().div_ceil(3) * 4);
    for chunk in value.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        output.push(ALPHABET[(first >> 2) as usize] as char);
        output.push(ALPHABET[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    output
}

fn host_string(mut output: Vec<u8>, written: i32) -> Result<String, Error> {
    if written < 0 || written as usize > output.len() {
        return Err(Error::HostRejected);
    }
    output.truncate(written as usize);
    String::from_utf8(output).map_err(|_| Error::InvalidUtf8)
}

#[cfg(test)]
mod tests {
    use super::{base64_encode, json_string};

    #[test]
    fn json_string_escapes_control_characters() {
        assert_eq!(json_string("a\n\"b"), "\"a\\n\\\"b\"");
    }

    #[test]
    fn preview_blob_base64_is_standard() {
        assert_eq!(base64_encode(b"BlinkHost"), "QmxpbmtIb3N0");
        assert_eq!(base64_encode(b"a"), "YQ==");
    }
}
