// Mock expo-sqlite for testing
export function openDatabaseSync(_name: string) {
  const store = new Map<string, any[]>();
  return {
    execSync: (_sql: string) => {},
    runSync: (_sql: string, _params?: any[]) => {},
    getAllSync: (_sql: string, _params?: any[]) => [],
  };
}
export default { openDatabaseSync };
