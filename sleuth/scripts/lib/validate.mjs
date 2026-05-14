/**
 * 校验 session ID，防止路径遍历攻击。
 * 只允许：字母、数字、连字符、下划线。
 */
export function validateSessionId(sid) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sid)) {
    throw new Error(`Invalid session ID: ${sid}`);
  }
}
