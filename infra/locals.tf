data "aws_caller_identity" "current" {}

locals {
  name       = var.project
  account_id = data.aws_caller_identity.current.account_id

  site_bucket_name  = "${var.project}-site-${local.account_id}"
  photo_bucket_name = "${var.project}-photos-${local.account_id}"
  table_name        = var.project

  app_url      = "https://${var.domain_name}"
  callback_url = "https://${var.domain_name}/auth/callback"

  api_key_param = "/${var.project}/prod/opencode-api-key"
}
