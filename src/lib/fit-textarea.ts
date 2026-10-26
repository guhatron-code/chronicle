/*
 * Grow an input to its text. The measurement sets the input to "auto" and reads
 * its scrollHeight, which lays the page out with the input at its smallest; a
 * box held at its current height keeps everything around it (the thread above)
 * where it is until the final height is known.
 */
type Sized = { style: { height: string } };

export function fitTextarea(ta: Sized & { scrollHeight: number }, box: (Sized & { offsetHeight: number }) | null): void {
  if (box) box.style.height = `${box.offsetHeight}px`;
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
  if (box) box.style.height = "";
}
