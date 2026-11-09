/** A sidebar selection is a hint; resolve it through the public vault API before use. */
export function selectedSidebarFolder(
  doc: Document | undefined,
  isFolder: (path: string) => boolean,
): string | null {
  if (!doc) return null;
  const root = doc.querySelector('[data-type="file-explorer"]');
  if (!root) return null;
  const selected = root.querySelectorAll(
    '.nav-folder-title.is-selected[data-path],.nav-folder-title[aria-selected="true"][data-path],.nav-folder-title.has-focus[data-path]',
  );
  const paths = [
    ...new Set(
      Array.from(selected)
        .map((el) => el.getAttribute("data-path"))
        .filter((p): p is string => p !== null),
    ),
  ];
  return paths.length === 1 && isFolder(paths[0]!) ? paths[0]! : null;
}
export function destinationPath(value: string): string {
  if (value === "" || value === "/") return "";
  if (
    value.startsWith("/") ||
    /[\\:\x00-\x1f]/.test(value) ||
    value
      .split("/")
      .some((p) => !p || p === ".." || p === "." || p.startsWith("."))
  )
    throw new Error("Choose a normal folder inside this vault");
  return value;
}
export function newFolderPath(parent: string, name: string): string {
  const base = destinationPath(parent),
    clean = name.trim();
  if (
    !clean ||
    clean.startsWith(".") ||
    /[\\/:*?"<>|\x00-\x1f]/.test(clean) ||
    clean.length > 120
  )
    throw new Error(
      "Enter a folder name without slashes, hidden prefixes or special filename characters",
    );
  return base ? `${base}/${clean}` : clean;
}
export async function createDestination<T>(
  vault: {
    getFolderByPath(path: string): T | null;
    getRoot(): T;
    getAbstractFileByPath(path: string): unknown;
    createFolder(path: string): Promise<T>;
  },
  parent: string,
  name: string,
): Promise<T> {
  const base = destinationPath(parent),
    target = newFolderPath(base, name);
  if (base && !vault.getFolderByPath(base))
    throw new Error(
      "The parent folder no longer exists. Choose a parent folder.",
    );
  if (vault.getAbstractFileByPath(target))
    throw new Error(
      "That name already exists. Choose the existing folder or enter another name.",
    );
  return vault.createFolder(target);
}
