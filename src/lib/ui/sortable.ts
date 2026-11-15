// Reordering a short list by holding and dragging a row's grip.
//
//   <div use:sortable={{ onMove: (from, to) => … }}>
//     <div data-sort> <button data-grip …>…</button> … </div>
//     …
//   </div>
//
// With a mouse the drag starts at once; with a finger or pen, after a short
// hold, so a quick touch does nothing. The row follows the pointer and the
// others slide aside to show where it will land. The grip also answers the
// arrow keys, moving the row one place at a time.

export interface SortableOptions {
  onMove: (from: number, to: number) => void;
}

const HOLD_MS = 220;

/** A copy of `list` with the item at `from` moved to `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

export function sortable(node: HTMLElement, options: SortableOptions) {
  let opts = options;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let drag: {
    grip: HTMLElement;
    row: HTMLElement;
    rows: HTMLElement[];
    tops: number[];
    from: number;
    to: number;
    startY: number;
    step: number;
    pointer: number;
  } | null = null;

  const rows = () => [...node.querySelectorAll<HTMLElement>(':scope > [data-sort]')];

  function begin(grip: HTMLElement, row: HTMLElement, from: number, y: number, pointer: number) {
    const list = rows();
    const rects = list.map((r) => r.getBoundingClientRect());
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    drag = { grip, row, rows: list, tops: rects.map((r) => r.top + r.height / 2), from, to: from, startY: y, step: rects[from].height + gap, pointer };
    try {
      grip.setPointerCapture(pointer);
    } catch {
      /* the pointer has already gone */
    }
    node.classList.add('sorting');
    row.classList.add('lifted');
    navigator.vibrate?.(8);
  }

  function down(e: PointerEvent) {
    const grip = (e.target as Element | null)?.closest<HTMLElement>('[data-grip]');
    if (!grip || e.button > 0) return;
    const row = grip.closest<HTMLElement>('[data-sort]');
    const from = row ? rows().indexOf(row) : -1;
    if (!row || from < 0 || row.parentElement !== node) return;
    e.preventDefault();
    const start = () => begin(grip, row, from, e.clientY, e.pointerId);
    if (e.pointerType === 'mouse') start();
    else hold = setTimeout(start, HOLD_MS);
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dy = e.clientY - drag.startY;
    drag.row.style.transform = `translateY(${dy}px)`;
    const centre = drag.tops[drag.from] + dy;
    let to = drag.from;
    drag.tops.forEach((t, i) => {
      if (i < drag!.from && centre < t) to = Math.min(to, i);
      if (i > drag!.from && centre > t) to = Math.max(to, i);
    });
    drag.to = to;
    drag.rows.forEach((r, i) => {
      if (i === drag!.from) return;
      const shift = drag!.from < to && i > drag!.from && i <= to ? -drag!.step : to < drag!.from && i >= to && i < drag!.from ? drag!.step : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function end(e: PointerEvent) {
    clearTimeout(hold);
    if (!drag || e.pointerId !== drag.pointer) return;
    const { from, to, rows: list, row } = drag;
    drag = null;
    list.forEach((r) => (r.style.transform = ''));
    row.classList.remove('lifted');
    node.classList.remove('sorting');
    if (to !== from) opts.onMove(from, to);
  }

  function key(e: KeyboardEvent) {
    const grip = (e.target as Element | null)?.closest<HTMLElement>('[data-grip]');
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const list = rows();
    const from = list.indexOf(grip.closest<HTMLElement>('[data-sort]')!);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= list.length) return;
    e.preventDefault();
    opts.onMove(from, to);
    // Keep the keyboard on the row that moved.
    requestAnimationFrame(() => rows()[to]?.querySelector<HTMLElement>('[data-grip]')?.focus());
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('keydown', key);
  return {
    update(next: SortableOptions) {
      opts = next;
    },
    destroy() {
      clearTimeout(hold);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('keydown', key);
    },
  };
}
