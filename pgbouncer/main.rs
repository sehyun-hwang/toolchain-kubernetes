use aws_config::BehaviorVersion;
use aws_credential_types::{provider::ProvideCredentials, Credentials};
use aws_sigv4::{
    http_request::{sign, SignableBody, SignableRequest, SignatureLocation, SigningSettings},
    sign::v4::SigningParams,
};
use aws_smithy_runtime_api::client::identity::Identity;
use reqwest;
use std::{
    env,
    error::Error,
    fs::File,
    io::Write,
    path::Path,
    time::{Duration, SystemTime},
};
use url::Url;

async fn generate_rds_iam_token(
    credentials: Credentials,
    region: &str,
    db_hostname: &str,
    db_user: &str,
) -> Result<String, Box<dyn Error>> {
    let mut signing_settings = SigningSettings::default();
    signing_settings.expires_in = Some(Duration::from_secs(900));
    signing_settings.signature_location = SignatureLocation::QueryParams;

    let identity: Identity = credentials.into();
    let signing_params = SigningParams::builder()
        .identity(&identity)
        .region(region)
        .name("rds-db")
        .time(SystemTime::now())
        .settings(signing_settings)
        .build()?;

    let url = format!(
        "https://{db_hostname}:{port}/?Action=connect&DBUser={db_user}",
        port = 5432,
    );

    let signable_request =
        SignableRequest::new("GET", &url, std::iter::empty(), SignableBody::Bytes(&[]))
            .expect("signable request");

    let (signing_instructions, _signature) =
        sign(signable_request, &signing_params.into())?.into_parts();

    let mut url = Url::parse(&url)?;
    for (name, value) in signing_instructions.params() {
        url.query_pairs_mut().append_pair(name, &value);
    }

    Ok(url.to_string().split_off("https://".len()))
}

async fn write_userlist_txt(credentials: Credentials) -> Result<String, Box<dyn Error>> {
    let db_host = env::var("DB_HOST").expect("DB_HOST env must be set");
    let db_user = env::var("DB_USER").expect("DB_USER env must be set");
    let parts: Vec<&str> = db_host.split('.').collect();
    let region = parts[parts.len() - 4];

    let token = generate_rds_iam_token(credentials, &region, &db_host, &db_user).await?;
    println!("Generated RDS IAM Auth token for {region}");

    let mut userlist = File::create("userlist.txt")?;
    writeln!(userlist, "\"{}\" \"{}\"", db_user, token)?;
    println!("Saved user and token to userlist.txt");

    if Path::new("k3s.service.env").exists() {
        let db_name = env::var("DB_NAME").expect("DB_NAME env must be set");
        let mut k3_env = File::create("k3s.service.env")?;
        let mut url = Url::parse(&format!("postgresql://{db_user}@{db_host}/{db_name}?sslmode=verify-ca&sslrootcert=/etc/rancher/k3s/rds.pem").to_string())?;
        url.query_pairs_mut().append_pair("password", &token);

        writeln!(k3_env, "K3S_DATASTORE_ENDPOINT=\"{url}\"")?;
        println!("Saved K3S_DATASTORE_ENDPOINT to k3s.service.env");
    }

    Ok(region.into())
}

async fn _main() -> Result<(), Box<dyn Error>> {
    let credentials = aws_config::load_defaults(BehaviorVersion::v2025_01_17())
        .await
        .credentials_provider()
        .expect("no credentials provider found")
        .provide_credentials()
        .await?;
    println!("Loaded AWS credential {:?}", credentials);
    let region = write_userlist_txt(credentials).await?;

    let bundle = reqwest::get(format!(
        "https://truststore.pki.rds.amazonaws.com/{region}/{region}-bundle.pem"
    ))
    .await?
    .text()
    .await?;

    let mut bundle_file = File::create("bundle.pem")?;
    bundle_file.write_all(bundle.as_bytes())?;
    println!("Downloaded and saved trust bundle to bundle.pem");

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    _main().await
}
