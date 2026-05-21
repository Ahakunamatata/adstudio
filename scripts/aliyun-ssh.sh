#!/usr/bin/env bash
# Aliyun ECS SSH wrapper —— 密码从 macOS Keychain 读，不进 history / 不显式打印
#
# 前提：
#   1. 密码已存进 Keychain：
#      security add-generic-password -U -a "root" -s "adstudio-aliyun" -w
#      （会交互式提示输入，密码不回显、不入 bash history）
#   2. 服务器 IP 写在 .env.local 里的 ALIYUN_SSH_HOST 变量
#
# 用法：
#   scripts/aliyun-ssh.sh                          交互式 shell
#   scripts/aliyun-ssh.sh "ls -la"                 跑一条远程命令
#   scripts/aliyun-ssh.sh --upload-pubkey          一次性把本机 id_ed25519.pub 装到 server，
#                                                  之后就可以用 ssh -i ~/.ssh/id_ed25519 不带密码
#   scripts/aliyun-ssh.sh --copy <local> <remote>  scp 上传文件

set -e

# 读取环境变量
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

HOST="${ALIYUN_SSH_HOST:-}"
USER="${ALIYUN_SSH_USER:-root}"
KEYCHAIN_SERVICE="${ALIYUN_KEYCHAIN_SERVICE:-adstudio-aliyun}"
KEYCHAIN_ACCOUNT="${ALIYUN_KEYCHAIN_ACCOUNT:-root}"

if [ -z "$HOST" ]; then
  echo "Error: ALIYUN_SSH_HOST not set in .env.local"
  exit 1
fi

# 从 Keychain 拿密码到一个临时变量（不打印）
PASSWORD=$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)
if [ -z "$PASSWORD" ]; then
  echo "Error: 密码没在 Keychain 里。先跑："
  echo "  security add-generic-password -U -a \"$KEYCHAIN_ACCOUNT\" -s \"$KEYCHAIN_SERVICE\" -w"
  exit 1
fi

# 第一参数 --upload-pubkey：一次性安装本机公钥到 server 的 authorized_keys
if [ "${1:-}" = "--upload-pubkey" ]; then
  PUBKEY=$(cat "${HOME}/.ssh/id_ed25519.pub")
  expect <<EOF
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -q '$PUBKEY' ~/.ssh/authorized_keys 2>/dev/null || echo '$PUBKEY' >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; echo PUBKEY_INSTALLED"
expect {
  "password:" { send "$PASSWORD\r"; exp_continue }
  "PUBKEY_INSTALLED" { exp_continue }
  eof
}
EOF
  echo ""
  echo "✅ Pubkey installed. 现在可以无密码 SSH："
  echo "    ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_ed25519 $USER@$HOST"
  exit 0
fi

# 第一参数 --copy：scp 上传
if [ "${1:-}" = "--copy" ]; then
  LOCAL="$2"
  REMOTE="$3"
  expect <<EOF
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "$LOCAL" "$USER@$HOST:$REMOTE"
expect {
  "password:" { send "$PASSWORD\r"; exp_continue }
  eof
}
EOF
  exit 0
fi

# 默认：跑命令或开 shell
REMOTE_CMD="${1:-}"
if [ -n "$REMOTE_CMD" ]; then
  expect <<EOF
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST "$REMOTE_CMD"
expect {
  "password:" { send "$PASSWORD\r"; exp_continue }
  eof
}
EOF
else
  expect <<EOF
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $USER@$HOST
expect {
  "password:" { send "$PASSWORD\r"; exp_continue }
  -re ".*\\\$ $" { interact }
  -re ".*# $" { interact }
}
EOF
fi
