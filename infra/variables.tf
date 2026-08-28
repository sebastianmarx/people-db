variable "project" {
  description = "Name prefix for all resources."
  type        = string
  default     = "people-db"
}

variable "aws_region" {
  description = "Primary region."
  type        = string
  default     = "eu-central-1"
}

variable "owner_email" {
  description = "Email of the single user allowed to use the app. Also receives budget alerts."
  type        = string
}

variable "domain_name" {
  description = "Fully qualified domain the app is served from."
  type        = string
  default     = "peopledb.familiemarx.click"
}

variable "route53_zone_name" {
  description = "Existing public hosted zone that contains domain_name. Trailing dot optional."
  type        = string
  default     = "familiemarx.click"
}

variable "cognito_domain_prefix" {
  description = "Globally unique prefix for the Cognito hosted-UI domain."
  type        = string
  default     = "peopledb-marx"
}

variable "llm_base_url" {
  description = "OpenAI-compatible base URL of the OpenCode Go endpoint."
  type        = string
  default     = "https://opencode.ai/zen/go/v1"
}

variable "llm_model" {
  description = "Model id used for extraction and chat."
  type        = string
  default     = "glm-5.3-flash"
}

variable "ai_enabled" {
  description = "Kill switch. When false the app never makes an outbound LLM call."
  type        = bool
  default     = true
}

variable "note_language" {
  description = "Language the notes are written in. Steers the extraction prompt."
  type        = string
  default     = "en"
}

variable "allowed_countries" {
  description = "ISO country codes allowed to reach CloudFront. Empty list disables geo restriction."
  type        = list(string)
  default     = ["DE", "AT", "CH"]
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}

variable "budget_limit_usd" {
  description = "Monthly AWS budget that triggers an email alert."
  type        = number
  default     = 5
}

variable "lambda_memory_mb" {
  type    = number
  default = 512
}

variable "lambda_timeout_s" {
  description = "Must comfortably exceed the slowest LLM chat round trip."
  type        = number
  default     = 60
}
