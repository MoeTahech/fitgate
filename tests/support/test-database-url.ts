const TEST_DATABASE_SUFFIX = "_test";

export function assertTestDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("TEST_DATABASE_URL is not set");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName.endsWith(TEST_DATABASE_SUFFIX) || databaseName === TEST_DATABASE_SUFFIX) {
    throw new Error(
      `Refusing to run tests: database name must end in "${TEST_DATABASE_SUFFIX}"`,
    );
  }

  return value;
}
