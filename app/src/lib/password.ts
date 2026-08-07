export interface ValidationResult {
  valid: boolean
  errors: string[]
}

const SPECIAL_CHARS = '!@#$%^&*()-_=+[]{}|;:,.<>?/~`\'"\\'.split('')

const COMMON_PASSWORDS = new Set([
  '123456', 'password', '12345678', 'qwerty', 'abc123', 'monkey', '1234567',
  'letmein', 'trustno1', 'dragon', 'baseball', 'iloveyou', 'master', 'sunshine',
  'ashley', 'bailey', 'passw0rd', 'shadow', '123123', '654321', 'superman',
  'qazwsx', 'michael', 'football', 'password1', '1q2w3e4r', 'login', 'welcome',
  'hello', 'charlie', 'donald', 'password123', 'qwerty123', 'iloveyou1',
  'admin123', 'admin', 'root', 'toor', 'pass', 'test', 'guest', '111111', '222222',
  '333333', '123321', '666666', '888888', '000000', '1234567890', 'qwertyuiop',
])

export function validatePassword(password: string, username: string): ValidationResult {
  const errors: string[] = []
  if (password.length < 8 || password.length > 64)
    errors.push('Password must be between 8 and 64 characters')
  if (!/[A-Z]/.test(password))
    errors.push('Password must contain at least one uppercase letter')
  if (!/[a-z]/.test(password))
    errors.push('Password must contain at least one lowercase letter')
  if (!SPECIAL_CHARS.some(c => password.includes(c)))
    errors.push('Password must contain at least one special character')
  if (/(.)\1{2,}/.test(password))
    errors.push('Password cannot contain 3 or more identical characters in a row')
  if (password.toLowerCase().includes('password'))
    errors.push('Password cannot contain the word "password"')
  if (password.toLowerCase().includes('unified'))
    errors.push('Password cannot contain the app name')
  if (username && password.toLowerCase().includes(username.toLowerCase()))
    errors.push('Password cannot contain your username')
  if (COMMON_PASSWORDS.has(password.toLowerCase()))
    errors.push('This password is too common. Please choose a more unique password')
  return { valid: errors.length === 0, errors }
}

export async function hashPassword(password: string): Promise<string> {
  const bcrypt = (await import('bcryptjs')).default
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const bcrypt = (await import('bcryptjs')).default
  return bcrypt.compare(password, hash)
}
