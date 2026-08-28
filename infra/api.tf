# ---------------------------------------------------------------------------
# API: one Python Lambda behind a Function URL. The Function URL uses IAM auth
# and is only invocable by this CloudFront distribution (see frontend.tf), so
# it cannot be called directly from the internet.
# ---------------------------------------------------------------------------
locals {
  lambda_zip = "${path.module}/../backend/build/lambda.zip"
}

# The OpenCode Go API key. Terraform creates the parameter with a placeholder;
# the real value is written once with the AWS CLI and then ignored here, so the
# secret never lands in state.
resource "aws_ssm_parameter" "opencode_api_key" {
  name        = local.api_key_param
  description = "OpenCode Go API key used for extraction and chat."
  type        = "SecureString"
  key_id      = "alias/aws/ssm" # AWS-managed key: no monthly key charge
  value       = "PLACEHOLDER-SET-ME"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "lambda_policy" {
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  statement {
    sid    = "Table"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchWriteItem",
      "dynamodb:BatchGetItem",
    ]
    resources = [aws_dynamodb_table.main.arn]
  }

  statement {
    sid    = "Photos"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.photos.arn}/photos/*"]
  }

  statement {
    sid       = "ApiKey"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.opencode_api_key.arn]
  }

  statement {
    sid       = "ApiKeyDecrypt"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:${var.aws_region}:${local.account_id}:alias/aws/ssm"]
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${local.name}-api"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_policy.json
}

resource "aws_lambda_function" "api" {
  function_name = "${local.name}-api"
  role          = aws_iam_role.lambda.arn
  runtime       = "python3.13"
  handler       = "app.main.handler"
  architectures = ["arm64"] # ~20% cheaper per GB-second than x86_64

  filename         = local.lambda_zip
  source_code_hash = fileexists(local.lambda_zip) ? filebase64sha256(local.lambda_zip) : null

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_s

  environment {
    variables = {
      TABLE_NAME        = aws_dynamodb_table.main.name
      PHOTO_BUCKET      = aws_s3_bucket.photos.id
      APP_URL           = local.app_url
      CALLBACK_URL      = local.callback_url
      COGNITO_REGION    = var.aws_region
      COGNITO_POOL_ID   = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID = aws_cognito_user_pool_client.web.id
      COGNITO_DOMAIN    = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
      OWNER_SUB         = aws_cognito_user.owner.sub
      LLM_BASE_URL      = var.llm_base_url
      LLM_MODEL         = var.llm_model
      LLM_KEY_PARAM     = aws_ssm_parameter.opencode_api_key.name
      AI_ENABLED        = tostring(var.ai_enabled)
      NOTE_LANGUAGE     = var.note_language
      LOG_LEVEL         = "INFO"
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}

# Only this CloudFront distribution may invoke the Function URL.
resource "aws_lambda_permission" "cloudfront" {
  statement_id           = "AllowCloudFrontInvoke"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.main.arn
  function_url_auth_type = "AWS_IAM"
}
