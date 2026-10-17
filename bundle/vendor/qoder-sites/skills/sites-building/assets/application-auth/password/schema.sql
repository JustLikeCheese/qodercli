-- Business data only. This example does not create user/session/OAuth tables.
CREATE TABLE app.app_notes (
  id uuid NOT NULL,
  owner_id text NOT NULL,
  title text NOT NULL,
  PRIMARY KEY (owner_id, id)
);

-- 版本 2（加法式）：自建账号认证所需的账号、会话与限流表。
-- 只新增表；不修改 app_notes，不做任何数据写入（DML）。
-- 访问策略由平台为 function_backend 生成固定私有策略（accessPolicies: []）。

CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_iterations integer NOT NULL,
  created_at timestamptz NOT NULL
);

-- 只保存令牌摘要、用户 ID 与时间；明文会话令牌从不落库。
CREATE TABLE app.sessions (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- 固定窗口限流：每题一行，唯一主键用于原子判定（并发安全）。
CREATE TABLE app.auth_limiter (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL
);
