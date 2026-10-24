export function nextOptionIndex(current: number, key: string, count: number): number {
  if (!count) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current + count - 1) % count;
  return (current + 1) % count;
}

export function findOptionByPrefix(labels: string[], prefix: string, current: number): number {
  const search = prefix.toLocaleLowerCase();
  for (let offset = 1; offset <= labels.length; offset++) {
    const index = (current + offset + labels.length) % labels.length;
    if (labels[index]!.toLocaleLowerCase().startsWith(search)) return index;
  }
  return -1;
}
