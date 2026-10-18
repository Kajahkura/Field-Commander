use crate::db::statement;
use crate::now;
use crate::{http_body, length, random_id, required_secret, text, Db, Failure, Result};
use serde_json::{json, Value};
pub fn coordinates(lat: Option<f64>, lon: Option<f64>) -> Result<(f64, f64)> {
    match (lat, lon) {
        (Some(a), Some(b))
            if a.is_finite()
                && b.is_finite()
                && (-90.0..=90.0).contains(&a)
                && (-180.0..=180.0).contains(&b) =>
        {
            Ok((a, b))
        }
        _ => Err(Failure::bad("Invalid coordinates")),
    }
}
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
fn cache(db: &Db, key: &str) -> Result<Option<Value>> {
    let rows = db.read(
        "SELECT payload FROM fc_cache WHERE workspace=? AND key=? AND expires_at>?",
        vec![json!(db.workspace), json!(key), json!(now().timestamp())],
    )?;
    Ok(rows
        .first()
        .and_then(|r| r[0].as_str())
        .and_then(|s| serde_json::from_str(s).ok()))
}
fn put(db: &Db, key: &str, payload: &Value, ttl: i64) -> Result<()> {
    let body = payload.to_string();
    if body.len() > 60000 {
        return Ok(());
    }
    db.write(vec![statement("INSERT INTO fc_cache(workspace,key,payload,expires_at) VALUES(?,?,?,?) ON CONFLICT(workspace,key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at",vec![json!(db.workspace),json!(key),json!(body),json!(now().timestamp()+ttl)])],&random_id()?)?;
    Ok(())
}
// A shared rolling minute/day gate. Only successful conditional inserts consume credit.
fn quota(db: &Db, provider: &str, cost: i64) -> Result<()> {
    let day = format!("{}:{}", provider, now().format("%Y-%m-%d"));
    let second = now().timestamp();
    let minute = second / 60;
    let max = if provider == "geoapify" {
        2400
    } else if provider == "weatherapi" {
        2500
    } else {
        4000
    };
    let sql="INSERT INTO fc_quota(workspace,key,used,minute,minute_used,second,second_used) VALUES(?,?,?,?,1,?,1) ON CONFLICT(workspace,key) DO UPDATE SET used=fc_quota.used+excluded.used,minute=excluded.minute,minute_used=CASE WHEN fc_quota.minute=excluded.minute THEN fc_quota.minute_used+1 ELSE 1 END,second=excluded.second,second_used=CASE WHEN fc_quota.second=excluded.second THEN fc_quota.second_used+1 ELSE 1 END WHERE fc_quota.used+excluded.used<=? AND (fc_quota.minute<>excluded.minute OR fc_quota.minute_used<30) AND (fc_quota.second<>excluded.second OR fc_quota.second_used<4) RETURNING used";
    let response = db.write(
        vec![statement(
            sql,
            vec![
                json!(db.workspace),
                json!(day),
                json!(cost),
                json!(minute),
                json!(second),
                json!(max),
            ],
        )],
        &random_id()?,
    )?;
    if response[0]["rows"].as_array().is_none_or(|r| r.is_empty()) {
        return Err(Failure {
            status: 429,
            message: "Workspace provider budget reached. Use saved information or try again later."
                .into(),
            entity: None,
        });
    }
    Ok(())
}
fn request(url: &str, ua: &str) -> Result<(Value, Value)> {
    let raw = blinkhost_sdk::fetch(
        "GET",
        url,
        &[("user-agent", ua), ("accept", "application/json")],
        None,
    )
    .map_err(|_| Failure::service("Weather or location service could not be reached"))?;
    let wrapper: Value =
        serde_json::from_str(&raw).map_err(|_| Failure::service("Provider response invalid"))?;
    let body = http_body(wrapper.clone())?;
    Ok((body, wrapper["headers"].clone()))
}
pub fn weather(db: &Db, v: &Value) -> Result<Value> {
    let (lat, lon) = coordinates(v["lat"].as_f64(), v["lon"].as_f64())?;
    let provider = v["provider"].as_str().unwrap_or("met");
    if !["met", "weatherapi"].contains(&provider) {
        return Err(Failure::bad("Unknown weather provider"));
    }
    let key = format!("weather:{provider}:{lat:.4}:{lon:.4}");
    if let Some(mut c) = cache(db, &key)? {
        c["cached"] = json!(true);
        return Ok(c);
    }
    quota(db, provider, 1)?;
    let mut ttl = 3600;
    let (body, name) = if provider == "met" {
        let contact = crate::secret("FIELD_CONTACT_URL")
            .unwrap_or_else(|_| "https://github.com/Kajahkura/Field-Commander".into());
        if !contact.starts_with("https://") || contact.contains(['\r', '\n']) {
            return Err(Failure::service(
                "An identifying contact URL is required for MET Norway",
            ));
        }
        let url = format!(
            "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={lat:.4}&lon={lon:.4}"
        );
        let (body, headers) = request(&url, &format!("FieldCommander/1.0 ({contact})"))?;
        if let Some(s) = headers["expires"].as_str() {
            if let Ok(d) = chrono::DateTime::parse_from_rfc2822(s) {
                ttl = (d.timestamp() - now().timestamp()).max(60)
            }
        }
        (body, "MET Norway")
    } else {
        let api_key = required_secret("WEATHERAPI_API_KEY")?;
        let url=format!("https://api.weatherapi.com/v1/forecast.json?key={}&q={lat:.4},{lon:.4}&days=3&aqi=no&alerts=no",encode(&api_key));
        (request(&url, "FieldCommander/1.0")?.0, "WeatherAPI")
    };
    let now = now();
    let mut points = Vec::new();
    if provider == "met" {
        let times = body["properties"]["timeseries"]
            .as_array()
            .ok_or_else(|| Failure::service("Forecast unavailable for this location"))?;
        for p in times.iter().take(48) {
            let d = &p["data"];
            let details = &d["instant"]["details"];
            if !details["air_temperature"].is_number() || !details["wind_speed"].is_number() {
                continue;
            }
            points.push(json!({"time":p["time"],"temperature":details["air_temperature"],"humidity":details["relative_humidity"],"rain":d["next_1_hours"]["details"]["precipitation_amount"].as_f64(),"wind":details["wind_speed"],"symbol":d["next_1_hours"]["summary"]["symbol_code"].as_str().unwrap_or("unknown")}))
        }
    } else {
        let days = body["forecast"]["forecastday"]
            .as_array()
            .ok_or_else(|| Failure::service("WeatherAPI forecast unavailable"))?;
        for day in days {
            if let Some(hours) = day["hour"].as_array() {
                for p in hours {
                    let epoch = p["time_epoch"].as_i64().unwrap_or(0);
                    if epoch < now.timestamp() {
                        continue;
                    }
                    if let Some(d) = chrono::DateTime::from_timestamp(epoch, 0) {
                        points.push(json!({"time":d.to_rfc3339(),"temperature":p["temp_c"],"humidity":p["humidity"],"rain":p["precip_mm"],"wind":p["wind_kph"].as_f64().unwrap_or(0.0)/3.6,"symbol":p["condition"]["text"]}))
                    }
                }
            }
        }
    }
    if points.is_empty() {
        return Err(Failure::service("No usable forecast returned"));
    }
    let response = json!({"provider":name,"fetchedAt":now.to_rfc3339(),"points":points});
    put(db, &key, &response, ttl)?;
    Ok(response)
}
pub fn geocode(db: &Db, v: &Value) -> Result<Value> {
    length(v, "text", 200, true)?;
    let query = text(v, "text")?;
    if query.trim().len() < 3 {
        return Err(Failure::bad("Enter at least three characters"));
    }
    let key = format!("geocode:{}", crate::hash(&query.to_lowercase()));
    if let Some(c) = cache(db, &key)? {
        return Ok(c);
    }
    let api_key = required_secret("GEOAPIFY_API_KEY")?;
    quota(db, "geoapify", 1)?;
    let url = format!(
        "https://api.geoapify.com/v1/geocode/search?text={}&limit=5&apiKey={}",
        encode(query),
        encode(&api_key)
    );
    let r = request(&url, "FieldCommander/1.0")?.0;
    let response = json!({"features":r["features"],"attribution":"Powered by Geoapify · © OpenStreetMap contributors"});
    put(db, &key, &response, 86400)?;
    Ok(response)
}
pub fn route(db: &Db, v: &Value) -> Result<Value> {
    let stops = v["stops"]
        .as_array()
        .ok_or_else(|| Failure::bad("Stops required"))?;
    if !(2..=8).contains(&stops.len()) {
        return Err(Failure::bad("Road estimates support between 2 and 8 stops"));
    }
    let coords: Result<Vec<String>> = stops
        .iter()
        .map(|s| {
            let (a, b) = coordinates(s["lat"].as_f64(), s["lon"].as_f64())?;
            Ok(format!("{a:.5},{b:.5}"))
        })
        .collect();
    let waypoints = coords?.join("|");
    let key = format!("route:{}", crate::hash(&waypoints));
    if let Some(c) = cache(db, &key)? {
        return Ok(c);
    }
    let api_key = required_secret("GEOAPIFY_API_KEY")?;
    quota(db, "geoapify", 100)?;
    let url = format!(
        "https://api.geoapify.com/v1/routing?waypoints={}&mode=drive&apiKey={}",
        encode(&waypoints),
        encode(&api_key)
    );
    let body = request(&url, "FieldCommander/1.0")?.0;
    let feature = &body["features"][0];
    let lines = feature["geometry"]["coordinates"]
        .as_array()
        .ok_or_else(|| Failure::service("No road route found"))?;
    let coords: Vec<Value> = lines
        .iter()
        .flat_map(|l| l.as_array().cloned().unwrap_or_default())
        .collect();
    if coords.len() > 10000
        || !feature["properties"]["distance"].is_number()
        || !feature["properties"]["time"].is_number()
    {
        return Err(Failure::service("Route response exceeds supported limits"));
    }
    let response = json!({"coordinates":coords,"distance":feature["properties"]["distance"],"time":feature["properties"]["time"],"attribution":"Powered by Geoapify · © OpenStreetMap contributors","mode":"drive"});
    put(db, &key, &response, 3600)?;
    Ok(response)
}
