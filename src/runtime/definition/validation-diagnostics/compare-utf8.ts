const encoder = new TextEncoder();

export const compareUtf8 = (left: string, right: string): number => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  for (const [index, leftByte] of leftBytes.entries()) {
    const rightByte = rightBytes[index];
    if (rightByte === undefined) return 1;

    const difference = leftByte - rightByte;
    if (difference !== 0) return difference;
  }

  return leftBytes.byteLength - rightBytes.byteLength;
};
