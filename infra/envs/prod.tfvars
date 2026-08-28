project               = "people-db"
aws_region            = "eu-central-1"
owner_email           = "sebastian.sm.marx@gmail.com"
domain_name           = "peopledb.familiemarx.click"
route53_zone_name     = "familiemarx.click"
cognito_domain_prefix = "peopledb-marx"

llm_base_url  = "https://opencode.ai/zen/go/v1"
llm_model     = "glm-5.3-flash"
ai_enabled    = true
note_language = "en"

allowed_countries  = ["DE", "AT", "CH"]
log_retention_days = 30
budget_limit_usd   = 5
