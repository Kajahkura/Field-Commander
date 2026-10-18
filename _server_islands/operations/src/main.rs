mod db;
mod providers;
use blinkhost_sdk::{respond, secret, Request, Response};
use chrono::{DateTime, Utc};
use db::{statement, Db};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
type Result<T> = std::result::Result<T, Failure>;
#[derive(Debug)]
struct Failure {
    status: u16,
    message: String,
    entity: Option<Value>,
}
impl Failure {
    fn bad(s: &str) -> Self {
        Self {
            status: 400,
            message: s.into(),
            entity: None,
        }
    }
    fn service(s: &str) -> Self {
        Self {
            status: 503,
            message: s.into(),
            entity: None,
        }
    }
    fn forbidden() -> Self {
        Self {
            status: 403,
            message: "Your role does not allow this action".into(),
            entity: None,
        }
    }
    fn conflict(entity: Option<Value>) -> Self {
        Self {
            status: 409,
            message: "This record changed on the server. Review both versions before continuing."
                .into(),
            entity,
        }
    }
}
fn required_secret(name: &str) -> Result<String> {
    secret(name).map_err(|_| Failure::service("Workspace configuration incomplete"))
}
fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
fn equal(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |x, (a, b)| x | (a ^ b)) == 0
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key]
        .as_str()
        .ok_or_else(|| Failure::bad(&format!("Missing {key}")))
}
fn length(v: &Value, key: &str, max: usize, required: bool) -> Result<()> {
    let s = text(v, key)?;
    if s.len() > max || (required && s.trim().is_empty()) {
        return Err(Failure::bad(&format!("Invalid {key}")));
    }
    Ok(())
}
fn now() -> DateTime<Utc> {
    let elapsed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("Clock before epoch");
    DateTime::from_timestamp(elapsed.as_secs() as i64, elapsed.subsec_nanos())
        .expect("Clock out of range")
}
fn date(v: &Value, key: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text(v, key)?)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|_| Failure::bad(&format!("Invalid {key}")))
}
fn id(s: &str) -> bool {
    (8..=100).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn random_id() -> Result<String> {
    let mut bytes = [0u8; 32];
    #[cfg(target_arch = "wasm32")]
    {
        if unsafe { random_get(bytes.as_mut_ptr(), bytes.len()) } != 0 {
            return Err(Failure::service("Secure random generation unavailable"));
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::io::Read;
        std::fs::File::open("/dev/urandom")
            .and_then(|mut f| f.read_exact(&mut bytes))
            .map_err(|_| Failure::service("Random source unavailable"))?
    }
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "wasi_snapshot_preview1")]
extern "C" {
    fn random_get(buf: *mut u8, len: usize) -> u16;
}
struct Actor {
    id: String,
    name: String,
    role: String,
}
fn owner_name() -> String {
    secret("FIELD_OWNER_NAME").unwrap_or_else(|_| "Workspace owner".into())
}
fn workspace_name() -> String {
    secret("FIELD_WORKSPACE_NAME").unwrap_or_else(|_| "Field Commander".into())
}
fn authenticate(db: &Db, token: &str) -> Result<Actor> {
    if token.len() < 32 || token.len() > 160 {
        return Err(Failure {
            status: 401,
            message: "A valid private workspace key is required".into(),
            entity: None,
        });
    }
    let owner = required_secret("FIELD_OWNER_KEY")?;
    if owner.len() < 32 {
        return Err(Failure::service("Owner key configuration invalid"));
    }
    let h = hash(token);
    if equal(&h, &hash(&owner)) {
        return Ok(Actor {
            id: "workspace-owner".into(),
            name: owner_name(),
            role: "owner".into(),
        });
    }
    let rows = db.read(
        "SELECT id,name,role FROM fc_members WHERE workspace=? AND key_hash=? AND active=1",
        vec![json!(db.workspace), json!(h)],
    )?;
    if let Some(row) = rows.first() {
        return Ok(Actor {
            id: row[0].as_str().unwrap_or("").into(),
            name: row[1].as_str().unwrap_or("").into(),
            role: row[2].as_str().unwrap_or("viewer").into(),
        });
    }
    Err(Failure {
        status: 401,
        message: "This access key is invalid or has been revoked".into(),
        entity: None,
    })
}
fn members(db: &Db) -> Result<Value> {
    let rows = db.read(
        "SELECT id,name,role,active FROM fc_members WHERE workspace=? ORDER BY name LIMIT 200",
        vec![json!(db.workspace)],
    )?;
    let mut out =
        vec![json!({"id":"workspace-owner","name":owner_name(),"role":"owner","active":true})];
    for row in rows {
        out.push(json!({"id":row[0],"name":row[1],"role":row[2],"active":row[3]==1}))
    }
    Ok(json!(out))
}
fn latest(db: &Db, id: &str) -> Result<Option<Value>> {
    let rows=db.read("SELECT payload FROM fc_events WHERE workspace=? AND entity_id=? ORDER BY revision DESC LIMIT 1",vec![json!(db.workspace),json!(id)])?;
    rows.first()
        .map(|r| {
            serde_json::from_str(r[0].as_str().unwrap_or(""))
                .map_err(|_| Failure::service("Stored record invalid"))
        })
        .transpose()
}
fn manage(a: &Actor) -> bool {
    a.role == "owner" || a.role == "dispatcher"
}
fn valid_entity(db: &Db, a: &Actor, e: &Value, old: Option<&Value>) -> Result<()> {
    if !id(text(e, "id")?) {
        return Err(Failure::bad("Invalid record ID"));
    }
    date(e, "updatedAt")?;
    if e.get("deleted").is_some() {
        return Err(Failure::bad(
            "Record deletion is not supported; retain operational history",
        ));
    }
    let kind = text(e, "kind")?;
    if old.is_some_and(|v| v["kind"] != e["kind"]) {
        return Err(Failure::bad("Record kind cannot change"));
    }
    if a.role == "viewer" {
        return Err(Failure::forbidden());
    }
    match kind {
        "site" => {
            if !manage(a) {
                return Err(Failure::forbidden());
            }
            length(e, "name", 160, true)?;
            for k in ["address", "entrance", "contact", "notes"] {
                length(e, k, 3000, false)?
            }
            providers::coordinates(e["lat"].as_f64(), e["lon"].as_f64())?;
        }
        "job" => {
            length(e, "title", 160, true)?;
            for k in ["notes", "outcome"] {
                length(e, k, 3000, false)?
            }
            date(e, "dueAt")?;
            date(e, "plannedAt")?;
            if !["planned", "assigned", "in-progress", "completed", "failed"]
                .contains(&text(e, "status")?)
            {
                return Err(Failure::bad("Invalid work status"));
            }
            if !["normal", "high"].contains(&text(e, "priority")?) {
                return Err(Failure::bad("Invalid priority"));
            }
            if !["Van", "Truck", "Pickup", "Motorcycle", "On foot"].contains(&text(e, "vehicle")?) {
                return Err(Failure::bad("Invalid vehicle"));
            }
            if ["completed", "failed"].contains(&text(e, "status")?)
                && text(e, "outcome")?.trim().is_empty()
            {
                return Err(Failure::bad(
                    "Record an outcome or failure reason before closing work",
                ));
            }
            let s = latest(db, text(e, "siteId")?)?
                .ok_or_else(|| Failure::bad("Destination does not exist"))?;
            if s["kind"] != "site" {
                return Err(Failure::bad("Destination must be a site"));
            }
            let assigned = text(e, "assigneeId")?;
            if !assigned.is_empty() && assigned != "workspace-owner" {
                let rows=db.read("SELECT id FROM fc_members WHERE workspace=? AND id=? AND active=1 AND role<>'viewer'",vec![json!(db.workspace),json!(assigned)])?;
                if rows.is_empty() {
                    return Err(Failure::bad("Assignee is unavailable"));
                }
            }
            let evidence = e["evidence"]
                .as_array()
                .ok_or_else(|| Failure::bad("Missing evidence snapshot"))?;
            if evidence.len() > 30 || evidence.iter().any(|v| v.to_string().len() > 1000) {
                return Err(Failure::bad("Evidence snapshot too large"));
            }
            if a.role == "field" {
                let prev = old.ok_or_else(Failure::forbidden)?;
                if prev["assigneeId"] != a.id {
                    return Err(Failure::forbidden());
                }
                let mut x = prev.clone();
                let mut y = e.clone();
                for k in ["status", "outcome", "revision", "updatedAt", "pending"] {
                    x.as_object_mut().unwrap().remove(k);
                    y.as_object_mut().unwrap().remove(k);
                }
                if x != y {
                    return Err(Failure::forbidden());
                }
            }
        }
        "report" => {
            length(e, "title", 160, true)?;
            length(e, "notes", 3000, true)?;
            let observed = date(e, "observedAt")?;
            let expires = date(e, "expiresAt")?;
            if observed > now() + chrono::Duration::minutes(1)
                || expires <= observed
                || expires - observed > chrono::Duration::days(7)
            {
                return Err(Failure::bad("Invalid observation or expiry window"));
            }
            if !["info", "caution", "blocked"].contains(&text(e, "severity")?)
                || !["road", "crossing", "entrance", "weather", "other"]
                    .contains(&text(e, "category")?)
                || ![
                    "All vehicles",
                    "Van",
                    "Truck",
                    "Pickup",
                    "Motorcycle",
                    "On foot",
                ]
                .contains(&text(e, "vehicle")?)
            {
                return Err(Failure::bad("Invalid report classification"));
            }
            if !e["verified"].is_boolean() {
                return Err(Failure::bad("Missing review status"));
            }
            let site = latest(db, text(e, "siteId")?)?
                .ok_or_else(|| Failure::bad("Site does not exist"))?;
            if site["kind"] != "site" {
                return Err(Failure::bad("Invalid site"));
            }
            if old.is_none() && (e["authorId"] != a.id || e["verified"] != false) {
                return Err(Failure::forbidden());
            }
            if let Some(prev) = old {
                if prev["authorId"] != e["authorId"] {
                    return Err(Failure::bad("Author cannot change"));
                }
                if !manage(a) && (prev["authorId"] != a.id || prev["verified"] != e["verified"]) {
                    return Err(Failure::forbidden());
                }
            }
        }
        "photo" => {
            length(e, "caption", 300, false)?;
            let data = text(e, "data")?;
            if !data.starts_with("data:image/jpeg;base64,")
                || data.len() > 55000
                || !data[23..]
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
            {
                return Err(Failure::bad(
                    "Photo must be a compressed JPEG smaller than 55 KB",
                ));
            }
            let report = latest(db, text(e, "reportId")?)?.ok_or_else(|| {
                Failure::bad("The report needs a server receipt before its photo")
            })?;
            if report["kind"] != "report" || (!manage(a) && report["authorId"] != a.id) {
                return Err(Failure::forbidden());
            }
            if old.is_some_and(|r| r["reportId"] != e["reportId"]) {
                return Err(Failure::bad("Photo cannot change its report"));
            }
        }
        _ => return Err(Failure::bad("Unknown record type")),
    }
    if e.to_string().len() > 60000 {
        return Err(Failure::bad("Record too large"));
    }
    Ok(())
}
fn mutate(db: &Db, a: &Actor, v: &Value) -> Result<Value> {
    let op = &v["operation"];
    let op_id = text(op, "id")?;
    if !id(op_id) {
        return Err(Failure::bad("Invalid operation ID"));
    }
    if op["expectedGeneration"] != db.generation {
        return Err(Failure{status:409,message:"Database generation changed. Export this device's pending work and reconnect before migrating it.".into(),entity:None});
    }
    let mut e = op["entity"].clone();
    if !e.is_object() {
        return Err(Failure::bad("Record required"));
    }
    e.as_object_mut().unwrap().remove("pending");
    let payload = e.to_string();
    let payload_hash = hash(&format!("{}:{}:{payload}", a.id, op["expectedRevision"]));
    // Read receipt, current revision and referenced records together to stay within
    // the serving timeout. Conditional SQL still enforces revision at commit time.
    let mut validation=vec![
  statement("SELECT payload,payload_hash FROM fc_events WHERE workspace=? AND operation_id=?",vec![json!(db.workspace),json!(op_id)]),
  statement("SELECT payload FROM fc_events WHERE workspace=? AND entity_id=? ORDER BY revision DESC LIMIT 1",vec![json!(db.workspace),e["id"].clone()])
 ];
    let reference = match e["kind"].as_str() {
        Some("job" | "report") => Some("siteId"),
        Some("photo") => Some("reportId"),
        _ => None,
    };
    if let Some(key) = reference {
        validation.push(statement("SELECT payload FROM fc_events WHERE workspace=? AND entity_id=? ORDER BY revision DESC LIMIT 1",vec![json!(db.workspace),e[key].clone()]));
    }
    if e["kind"] == "job" {
        validation.push(statement(
            "SELECT id FROM fc_members WHERE workspace=? AND id=? AND active=1 AND role<>'viewer'",
            vec![json!(db.workspace), e["assigneeId"].clone()],
        ));
    }
    db.prefetch(validation)?;
    let receipt = db.read(
        "SELECT payload,payload_hash FROM fc_events WHERE workspace=? AND operation_id=?",
        vec![json!(db.workspace), json!(op_id)],
    )?;
    if let Some(r) = receipt.first() {
        if r[1] != payload_hash {
            return Err(Failure::bad("Operation ID was reused with different data"));
        }
        return Ok(
            json!({"entity":serde_json::from_str::<Value>(r[0].as_str().unwrap_or("")).map_err(|_|Failure::service("Receipt invalid"))?}),
        );
    }
    let entity_id = text(&e, "id")?;
    let old = latest(db, entity_id)?;
    let expected = op["expectedRevision"]
        .as_u64()
        .ok_or_else(|| Failure::bad("Revision required"))?;
    let revision = e["revision"]
        .as_u64()
        .ok_or_else(|| Failure::bad("Revision required"))?;
    if revision != expected + 1 || expected > 100000000 {
        return Err(Failure::bad("Invalid revision"));
    }
    if old
        .as_ref()
        .map(|v| v["revision"].as_u64().unwrap_or(0))
        .unwrap_or(0)
        != expected
    {
        return Err(Failure::conflict(old));
    }
    valid_entity(db, a, &e, old.as_ref())?;
    // The conditional append and unique constraints protect against concurrent editors.
    let sql="INSERT INTO fc_events(workspace,entity_id,revision,operation_id,actor_id,payload,payload_hash) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM fc_events WHERE workspace=? AND entity_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM fc_events WHERE workspace=? AND operation_id=?) RETURNING payload,payload_hash";
    let committed = db.write(
        vec![statement(
            sql,
            vec![
                json!(db.workspace),
                json!(entity_id),
                json!(revision),
                json!(op_id),
                json!(a.id),
                json!(payload),
                json!(payload_hash),
                json!(db.workspace),
                json!(entity_id),
                json!(expected),
                json!(db.workspace),
                json!(op_id),
            ],
        )],
        op_id,
    )?;
    let rows = db::decode_rows(&committed[0])?;
    if let Some(row) = rows.first() {
        if row[1] != payload_hash {
            return Err(Failure::service("Committed receipt mismatch"));
        }
        return Ok(
            json!({"entity":serde_json::from_str::<Value>(row[0].as_str().unwrap_or("")).map_err(|_|Failure::service("Receipt invalid"))?}),
        );
    }
    let receipt = db.read(
        "SELECT payload,payload_hash FROM fc_events WHERE workspace=? AND operation_id=?",
        vec![json!(db.workspace), json!(op_id)],
    )?;
    if let Some(r) = receipt.first() {
        if r[1] != payload_hash {
            return Err(Failure::bad("Operation ID reuse detected"));
        }
        return Ok(
            json!({"entity":serde_json::from_str::<Value>(r[0].as_str().unwrap_or("")).map_err(|_|Failure::service("Receipt invalid"))?}),
        );
    }
    Err(Failure::conflict(latest(db, entity_id)?))
}
fn state(db: &Db, v: &Value) -> Result<Value> {
    let cursor = v["cursor"].as_str().unwrap_or("");
    if cursor.len() > 100 {
        return Err(Failure::bad("Invalid page cursor"));
    }
    let rows=db.read("WITH latest AS (SELECT entity_id,payload,ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY revision DESC) AS n FROM fc_events WHERE workspace=?) SELECT entity_id,payload FROM latest WHERE n=1 AND entity_id>? ORDER BY entity_id LIMIT 2",vec![json!(db.workspace),json!(cursor)])?;
    let entities: Result<Vec<Value>> = rows
        .iter()
        .map(|r| {
            serde_json::from_str(r[1].as_str().unwrap_or(""))
                .map_err(|_| Failure::service("Stored entity invalid"))
        })
        .collect();
    let next = if rows.len() == 2 {
        rows.last().unwrap()[0].clone()
    } else {
        json!("")
    };
    Ok(json!({"entities":entities?,"cursor":next}))
}
fn http_body(v: Value) -> Result<Value> {
    if let Some(status) = v["status"].as_u64() {
        if !(200..300).contains(&status) {
            return Err(Failure::service(
                "Upstream service unavailable or quota exceeded",
            ));
        }
    }
    if let Some(s) = v["body"].as_str() {
        serde_json::from_str(s).map_err(|_| Failure::service("Upstream response invalid"))
    } else if v.get("body").is_some() {
        Ok(v["body"].clone())
    } else {
        Ok(v)
    }
}
fn run(req: Request) -> Result<Value> {
    if req.method != "POST" {
        return Err(Failure {
            status: 405,
            message: "Use POST".into(),
            entity: None,
        });
    }
    if req.body.len() > 80000 {
        return Err(Failure::bad("Request exceeds 80 KB"));
    }
    let v: Value = serde_json::from_slice(&req.body).map_err(|_| Failure::bad("Invalid JSON"))?;
    let header = req.header("authorization").unwrap_or_default();
    let token = header.strip_prefix("Bearer ").unwrap_or("");
    if token.len() < 32 || token.len() > 160 {
        return Err(Failure {
            status: 401,
            message: "A valid private workspace key is required".into(),
            entity: None,
        });
    }
    let db = Db::new()?;
    let a = authenticate(&db, token)?;
    match text(&v, "action")? {
        "login" => Ok(
            json!({"identity":{"id":a.id,"name":a.name,"role":a.role,"workspace":workspace_name(),"workspaceId":db.workspace,"dbGeneration":db.generation},"members":members(&db)?,"providers":{"geoapify":secret("GEOAPIFY_API_KEY").is_ok(),"weatherapi":secret("WEATHERAPI_API_KEY").is_ok()}}),
        ),
        "state" => state(&db, &v),
        "mutate" => mutate(&db, &a, &v),
        "weather" => providers::weather(&db, &v),
        "geocode" => {
            if !manage(&a) {
                return Err(Failure::forbidden());
            }
            providers::geocode(&db, &v)
        }
        "route" => providers::route(&db, &v),
        "invite" => {
            if a.role != "owner" {
                return Err(Failure::forbidden());
            }
            length(&v, "name", 100, true)?;
            let role = text(&v, "role")?;
            if !["dispatcher", "field", "viewer"].contains(&role) {
                return Err(Failure::bad("Invalid member role"));
            }
            if db
                .read(
                    "SELECT id FROM fc_members WHERE workspace=? AND active=1 LIMIT 200",
                    vec![json!(db.workspace)],
                )?
                .len()
                >= 199
            {
                return Err(Failure::bad("Workspace member limit reached"));
            }
            let key = random_id()?;
            let member_id = random_id()?;
            db.write(
                vec![statement(
                    "INSERT INTO fc_members(workspace,id,name,role,key_hash) VALUES(?,?,?,?,?)",
                    vec![
                        json!(db.workspace),
                        json!(member_id),
                        v["name"].clone(),
                        json!(role),
                        json!(hash(&key)),
                    ],
                )],
                &random_id()?,
            )?;
            Ok(
                json!({"key":key,"member":{"id":member_id,"name":v["name"],"role":role,"active":true}}),
            )
        }
        "revoke" => {
            if a.role != "owner" {
                return Err(Failure::forbidden());
            }
            let member_id = text(&v, "id")?;
            db.write(
                vec![statement(
                    "UPDATE fc_members SET active=0 WHERE workspace=? AND id=?",
                    vec![json!(db.workspace), json!(member_id)],
                )],
                &random_id()?,
            )?;
            Ok(json!({"ok":true}))
        }
        _ => Err(Failure::bad("Unknown action")),
    }
}
fn main() {
    let result = Request::from_host()
        .map_err(|_| Failure::bad("Request unavailable"))
        .and_then(run);
    let (status, body) = match result {
        Ok(v) => (200, v),
        Err(e) => (
            e.status,
            json!({"error":"request_failed","message":e.message,"entity":e.entity}),
        ),
    };
    let response = Response::json(status, body.to_string())
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff");
    if respond(response).is_err() {
        std::process::abort()
    }
}
