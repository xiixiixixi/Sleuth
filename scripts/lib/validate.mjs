/**
 * 校验 session ID，防止路径遍历攻击。
 * 只允许：字母、数字、连字符、下划线。
 */
export function validateSessionId(sid) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sid)) {
    throw new Error(`Invalid session ID: ${sid}`);
  }
}

/**
 * 校验 / 清洗 agent 名称。
 * agent 名称只用于输出目录分层。
 */
export function sanitizeAgentName(agent = 'main') {
  const clean = String(agent || 'main')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return clean || 'main';
}
