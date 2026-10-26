// Text cut to a number of columns with an ellipsis, for lines that must not wrap. Counts code points,
// which is right for the plain text taste lays out; wide characters may still run over.
function fit(text: string, room: number): string {
  if (room <= 0) return "";
  const chars = [...text];
  return chars.length <= room ? text : `${chars.slice(0, room - 1).join("")}…`;
}

export { fit };
