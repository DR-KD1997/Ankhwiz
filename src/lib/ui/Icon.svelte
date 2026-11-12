<script lang="ts">
  type Name = 'close' | 'back' | 'gear' | 'lock' | 'check' | 'cross' | 'play' | 'plus' | 'sun' | 'trash' | 'dot' | 'repeat' | 'chat' | 'sound' | 'more' | 'cards' | 'chart' | 'target' | 'up' | 'down' | 'edit' | 'search' | 'download';
  let { name, size = 20 }: { name: Name; size?: number } = $props();
  const paths: Record<Name, string> = {
    close: 'M5 5 L19 19 M19 5 L5 19',
    back: 'M14 5 L7 12 L14 19',
    gear: 'M4 7 H13 M17 7 H20 M4 17 H7 M11 17 H20 M15 4.5 V9.5 M9 14.5 V19.5',
    lock: 'M7 11 V8 A5 5 0 0 1 17 8 V11 M5.5 11 H18.5 V20 H5.5 Z',
    check: 'M5 12.5 L10 17.5 L19 7',
    cross: 'M6 6 L18 18 M18 6 L6 18',
    play: 'M8 5 L19 12 L8 19 Z',
    plus: 'M12 5 V19 M5 12 H19',
    sun: 'M12 7.5 A4.5 4.5 0 1 0 12 16.5 A4.5 4.5 0 1 0 12 7.5 M12 2 V4.5 M12 19.5 V22 M2 12 H4.5 M19.5 12 H22 M4.9 4.9 L6.7 6.7 M17.3 17.3 L19.1 19.1 M4.9 19.1 L6.7 17.3 M17.3 6.7 L19.1 4.9',
    trash: 'M5 7 H19 M9 7 V4.5 H15 V7 M7 7 L8 20 H16 L17 7 M10.5 10.5 V16.5 M13.5 10.5 V16.5',
    dot: 'M12 9 A3 3 0 1 0 12 15 A3 3 0 1 0 12 9',
    sound: 'M4 9.5 H8 L13 5 V19 L8 14.5 H4 Z M16.5 9 A4 4 0 0 1 16.5 15 M19 6.5 A7.5 7.5 0 0 1 19 17.5',
    more: 'M5 12 H5.01 M12 12 H12.01 M19 12 H19.01',
    cards: 'M8 4 H20 V16 M4 8 H16 V20 H4 Z',
    chart: 'M4 20 H20 M7 20 V13 M12 20 V8 M17 20 V4',
    target: 'M12 3 A9 9 0 1 0 12 21 A9 9 0 1 0 12 3 M12 8 A4 4 0 1 0 12 16 A4 4 0 1 0 12 8',
    up: 'M6 15 L12 9 L18 15',
    down: 'M6 9 L12 15 L18 9',
    edit: 'M4 20 H8 L19 9 L15 5 L4 16 Z M13 7 L17 11',
    search: 'M10.5 4 A6.5 6.5 0 1 0 10.5 17 A6.5 6.5 0 1 0 10.5 4 M15.5 15.5 L20 20',
    download: 'M12 4 V15 M7 10 L12 15 L17 10 M5 20 H19',
    chat: 'M4 5 H20 V16 H11 L6 20 V16 H4 Z M8 9 H16 M8 12 H13',
    repeat: 'M5 11 A7 7 0 0 1 18.5 8.5 M19 4.5 V9 H14.5 M19 13 A7 7 0 0 1 5.5 15.5 M5 19.5 V15 H9.5',
  };
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="2.25"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
