function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in your shell or CI secrets before running the login suite.`
    );
  }

  return value;
}

export const DEFAULT_LOGIN_URL = requireEnv('LOGIN_PAGE_URL');
export const VALID_USERNAME = requireEnv('LOGIN_TEST_USER');
export const VALID_PASSWORD = requireEnv('LOGIN_TEST_PASSWORD');
