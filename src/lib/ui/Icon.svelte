<script lang="ts">
  type Name = 'close' | 'back' | 'gear' | 'lock' | 'check' | 'cross' | 'play' | 'plus' | 'sun' | 'trash' | 'dot' | 'repeat' | 'chat' | 'sound' | 'more' | 'cards' | 'chart' | 'target' | 'up' | 'down' | 'edit' | 'search' | 'download' | 'info' | 'bell' | 'upload' | 'picture' | 'layers' | 'keyboard' | 'flag' | 'bulb' | 'resume' | 'grip';
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
    grip: 'M9 6 L9 6.01 M15 6 L15 6.01 M9 12 L9 12.01 M15 12 L15 12.01 M9 18 L9 18.01 M15 18 L15 18.01',
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
    info: 'M12 3 A9 9 0 1 0 12 21 A9 9 0 1 0 12 3 M12 11 V16.5 M12 7.6 V7.7',
    bell: 'M6 16 V11 A6 6 0 0 1 18 11 V16 L20 18 H4 Z M10 21 H14',
    upload: 'M12 20 V9 M7 14 L12 9 L17 14 M5 4 H19',
    picture: 'M4 5 H20 V19 H4 Z M4 16 L9 11 L13 15 L16 12 L20 16 M15.5 8.5 H15.51',
    layers: 'M12 4 L21 9 L12 14 L3 9 Z M3 13.5 L12 18.5 L21 13.5',
    keyboard: 'M3 6 H21 V18 H3 Z M7 10 H7.01 M11 10 H11.01 M15 10 H15.01 M17 10 H17.01 M7 14 H17',
    flag: 'M6 21 V4 M6 4 H17 L15 8 L17 12 H6',
    bulb: 'M9 18 H15 M10 21 H14 M12 3 A6 6 0 0 0 8 13.5 C9 14.5 9.5 15.5 9.5 16.5 H14.5 C14.5 15.5 15 14.5 16 13.5 A6 6 0 0 0 12 3 Z',
    resume: 'M5 12 A7 7 0 1 0 8 6.3 M8 2.5 V6.5 H4 M10.5 9 L15 12 L10.5 15 Z',
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
