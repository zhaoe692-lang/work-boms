const STORAGE_KEY = "workboms.artifactFavorites.v1";

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeSet(set: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

export function isArtifactFavorite(artifactId: string): boolean {
  return readSet().has(artifactId);
}

export function toggleArtifactFavorite(artifactId: string): boolean {
  const set = readSet();
  if (set.has(artifactId)) {
    set.delete(artifactId);
    writeSet(set);
    return false;
  }
  set.add(artifactId);
  writeSet(set);
  return true;
}

export function listFavoriteIds(): string[] {
  return [...readSet()];
}

export function listFavoriteKeys(): { packageId: string; artifactId: string }[] {
  return [...readSet()].flatMap((key) => {
    const idx = key.indexOf(":");
    if (idx <= 0) return [];
    return [{ packageId: key.slice(0, idx), artifactId: key.slice(idx + 1) }];
  });
}

export function isArtifactKeyFavorite(packageId: string, artifactId: string): boolean {
  return readSet().has(`${packageId}:${artifactId}`) || readSet().has(artifactId);
}

export function toggleArtifactKeyFavorite(packageId: string, artifactId: string): boolean {
  const key = `${packageId}:${artifactId}`;
  const set = readSet();
  if (set.has(key)) {
    set.delete(key);
    writeSet(set);
    return false;
  }
  set.add(key);
  writeSet(set);
  return true;
}
