use crate::{Failure, Result};
use serde_json::{json, Value};
use std::{cell::RefCell, collections::BTreeMap};
#[derive(Clone)]
pub struct Db {
    pub workspace: String,
    pub generation: String,
    cache: RefCell<BTreeMap<String, Vec<Vec<Value>>>>,
    #[cfg(not(feature = "native-db"))]
    url: String,
    #[cfg(not(feature = "native-db"))]
    token: String,
    #[cfg(feature = "native-db")]
    id: String,
}
pub struct Statement {
    pub sql: String,
    pub params: Vec<Value>,
    pub assertion: Option<u64>,
}
pub fn statement(sql: &str, params: Vec<Value>) -> Statement {
    Statement {
        sql: sql.into(),
        params,
        assertion: None,
    }
}
fn typed(v: &Value) -> Value {
    match v {
        Value::Null => json!({"type":"null"}),
        Value::Number(n) if n.is_i64() => json!({"type":"integer","value":n.to_string()}),
        Value::Number(n) => json!({"type":"real","value":n}),
        Value::String(s) => json!({"type":"text","value":s}),
        _ => json!({"type":"text","value":v.to_string()}),
    }
}
pub(crate) fn decode_rows(result: &Value) -> Result<Vec<Vec<Value>>> {
    let rows = result
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| Failure::service("Malformed database result"))?;
    rows.iter()
        .map(|r| {
            r.as_array()
                .ok_or_else(|| Failure::service("Malformed database row"))
                .map(|r| {
                    r.iter()
                        .map(|v| match v.get("type").and_then(Value::as_str) {
                            Some("null") => Value::Null,
                            Some("integer") => v["value"]
                                .as_str()
                                .and_then(|s| s.parse::<i64>().ok())
                                .map(Value::from)
                                .unwrap_or(Value::Null),
                            _ => v["value"].clone(),
                        })
                        .collect()
                })
        })
        .collect()
}
impl Db {
    pub fn new() -> Result<Self> {
        let workspace = crate::required_secret("FIELD_WORKSPACE_ID")?;
        #[cfg(feature = "native-db")]
        {
            let id = crate::required_secret("FIELD_DB_ID")?;
            let body=json!({"binding":"DEFAULT","operation":{"kind":"read","request":{"routing":{"consistency":"primary"},"statements":[{"sql":"SELECT 1","params":[]}]}}}).to_string();
            let mut output = vec![0u8; 132096];
            let len = unsafe {
                database_v1(
                    body.as_ptr() as i32,
                    body.len() as i32,
                    output.as_mut_ptr() as i32,
                    output.len() as i32,
                )
            };
            if len < 0 || len as usize > output.len() {
                return Err(Failure::service(
                    "Workspace sync is temporarily unavailable. Saved work remains on this device.",
                ));
            }
            let v: Value = serde_json::from_slice(&output[..len as usize])
                .map_err(|_| Failure::service("Malformed native database response"))?;
            if v["response"]["error"].as_str().is_some() {
                return Err(Failure::service(
                    "Workspace sync is temporarily unavailable. Saved work remains on this device.",
                ));
            }
            if v["database_id"] != id {
                return Err(Failure::service("Database binding identity changed"));
            }
            let generation = v["generation"]
                .as_str()
                .filter(|s| crate::id(s))
                .ok_or_else(|| Failure::service("Database generation unavailable"))?
                .to_owned();
            if blinkhost_sdk::secret("FIELD_DB_GENERATION")
                .is_ok_and(|expected| expected != generation)
            {
                return Err(Failure::service(
                    "Database generation changed; the owner must verify the binding",
                ));
            }
            Ok(Self {
                workspace,
                generation,
                id,
                cache: RefCell::new(BTreeMap::new()),
            })
        }
        #[cfg(not(feature = "native-db"))]
        {
            let generation = crate::required_secret("FIELD_DB_GENERATION")?;
            let url = crate::required_secret("FIELD_DB_URL")?;
            let token = crate::required_secret("FIELD_DB_TOKEN")?;
            if !url.starts_with("https://")
                || !url.ends_with(".turso.io")
                || url.contains('@')
                || url.contains('?')
                || url.contains('#')
                || url[8..].contains('/')
            {
                return Err(Failure::service(
                    "Managed database URL must be an HTTPS Turso hostname",
                ));
            }
            Ok(Self {
                workspace,
                generation,
                url,
                token,
                cache: RefCell::new(BTreeMap::new()),
            })
        }
    }
    // Cache only explicitly prefetched validation reads within this invocation.
    pub fn prefetch(&self, statements: Vec<Statement>) -> Result<()> {
        let keys: Vec<String> = statements
            .iter()
            .map(|s| json!([s.sql, s.params]).to_string())
            .collect();
        let results = self.execute(statements, None)?;
        if results.len() != keys.len() {
            return Err(Failure::service("Incomplete validation snapshot"));
        }
        for (key, result) in keys.into_iter().zip(results.iter()) {
            self.cache.borrow_mut().insert(key, decode_rows(result)?);
        }
        Ok(())
    }
    pub fn read(&self, sql: &str, params: Vec<Value>) -> Result<Vec<Vec<Value>>> {
        let key = json!([sql, params]).to_string();
        if let Some(rows) = self.cache.borrow().get(&key) {
            return Ok(rows.clone());
        }
        let result = self.execute(vec![statement(sql, params)], None)?;
        decode_rows(&result[0])
    }
    pub fn write(&self, statements: Vec<Statement>, operation: &str) -> Result<Vec<Value>> {
        self.cache.borrow_mut().clear();
        self.execute(statements, Some(operation))
    }
    #[cfg(feature = "native-db")]
    fn execute(&self, statements: Vec<Statement>, operation: Option<&str>) -> Result<Vec<Value>> {
        let stmts: Vec<Value> = statements
            .iter()
            .map(|s| {
                let mut v =
                    json!({"sql":s.sql,"params":s.params.iter().map(typed).collect::<Vec<_>>()});
                if let Some(a) = s.assertion {
                    v["expect_affected_rows"] = json!(a)
                }
                v
            })
            .collect();
        let op = match operation {
            Some(id) => {
                json!({"kind":"transaction","request":{"operation_id":id,"statements":stmts}})
            }
            None => {
                json!({"kind":"read","request":{"routing":{"consistency":"primary"},"statements":stmts}})
            }
        };
        let mut input = json!({"binding":"DEFAULT","operation":op});
        if operation.is_some() {
            input["expected"] = json!({"database_id":self.id,"generation":self.generation})
        }
        let body = input.to_string();
        if body.len() > 250000 {
            return Err(Failure::bad("Database request too large"));
        }
        let mut output = vec![0u8; 132096];
        let len = unsafe {
            database_v1(
                body.as_ptr() as i32,
                body.len() as i32,
                output.as_mut_ptr() as i32,
                output.len() as i32,
            )
        };
        if len < 0 || len as usize > output.len() {
            return Err(Failure::service("Native database capability unavailable"));
        }
        let v: Value = serde_json::from_slice(&output[..len as usize])
            .map_err(|_| Failure::service("Malformed native database response"))?;
        if v["database_id"] != self.id || v["generation"] != self.generation {
            return Err(Failure::service(
                "Database scope changed; reconnect only after the owner verifies the binding",
            ));
        }
        let response = &v["response"];
        if response["outcome"] == "unknown" {
            return Err(Failure::service(
                "Database outcome uncertain; retry the same operation",
            ));
        }
        if response["error"].as_str().is_some() || response["outcome"] == "not_committed" {
            return Err(Failure::service(
                "Database request not committed; retry the same operation",
            ));
        }
        response["results"].as_array().cloned().ok_or_else(|| {
            Failure::service("Database receipt unavailable; retry the same operation")
        })
    }
    #[cfg(not(feature = "native-db"))]
    fn execute(&self, statements: Vec<Statement>, operation: Option<&str>) -> Result<Vec<Value>> {
        let mut steps = Vec::new();
        if operation.is_some() {
            steps.push(json!({"stmt":{"sql":"BEGIN IMMEDIATE","args":[]}}))
        }
        for stmt in &statements {
            let mut step = json!({"stmt":{"sql":stmt.sql,"args":stmt.params.iter().map(typed).collect::<Vec<_>>(),"want_rows":true}});
            if operation.is_some() {
                step["condition"] = json!({"type":"ok","step":steps.len()-1})
            }
            steps.push(step);
        }
        if operation.is_some() {
            let prev = steps.len() - 1;
            steps.push(
                json!({"condition":{"type":"ok","step":prev},"stmt":{"sql":"COMMIT","args":[]}}),
            );
            let commit = steps.len() - 1;
            steps.push(json!({"condition":{"type":"not","cond":{"type":"ok","step":commit}},"stmt":{"sql":"ROLLBACK","args":[]}}));
        }
        let body = json!({"requests":[{"type":"batch","batch":{"steps":steps}},{"type":"close"}]})
            .to_string();
        let auth = format!("Bearer {}", self.token);
        let raw = blinkhost_sdk::fetch(
            "POST",
            &format!("{}/v2/pipeline", self.url),
            &[
                ("authorization", &auth),
                ("content-type", "application/json"),
            ],
            Some(&body),
        )
        .map_err(|_| Failure::service("Database connection failed; retry the same operation"))?;
        let wrapper: Value = serde_json::from_str(&raw)
            .map_err(|_| Failure::service("Database response invalid"))?;
        let v = crate::http_body(wrapper)?;
        let batch = &v["results"][0];
        if batch["type"] == "error" {
            return Err(Failure::service(
                "Database batch failed; retry the same operation",
            ));
        }
        let result = &batch["response"]["result"];
        if result["step_errors"]
            .as_array()
            .is_some_and(|r| r.iter().any(|v| !v.is_null()))
        {
            return Err(Failure::service(
                "Database transaction rolled back; retry the same operation",
            ));
        }
        let results = result["step_results"]
            .as_array()
            .ok_or_else(|| Failure::service("Database result missing"))?;
        let offset = usize::from(operation.is_some());
        let output: Vec<Value> = results
            .iter()
            .skip(offset)
            .take(statements.len())
            .map(|r| {
                let mut v = r.clone();
                v["affected_rows"] = r["affected_row_count"].clone();
                v
            })
            .collect();
        for (s, r) in statements.iter().zip(output.iter()) {
            if s.assertion
                .is_some_and(|a| r["affected_row_count"].as_u64() != Some(a))
            {
                return Err(Failure::service("Conditional database write failed"));
            }
        }
        Ok(output)
    }
}
#[cfg(feature = "native-db")]
#[link(wasm_import_module = "blinkhost_system")]
extern "C" {
    fn database_v1(input: i32, length: i32, output: i32, capacity: i32) -> i32;
}
