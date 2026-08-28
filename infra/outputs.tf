output "app_url" {
  description = "Open this on your phone."
  value       = local.app_url
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "site_bucket" {
  value = aws_s3_bucket.site.id
}

output "photo_bucket" {
  value = aws_s3_bucket.photos.id
}

output "table_name" {
  value = aws_dynamodb_table.main.name
}

output "lambda_function_name" {
  value = aws_lambda_function.api.function_name
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  value = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "owner_sub" {
  value = aws_cognito_user.owner.sub
}

output "api_key_parameter" {
  description = "Write the OpenCode Go key here (see README)."
  value       = aws_ssm_parameter.opencode_api_key.name
}
