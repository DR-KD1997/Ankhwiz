<script lang="ts">
  // Thoth, final concept, traced from the approved artwork: profile against a
  // gold sun disc, emerald headdress, crescent and sphere crown.
  // The full figure has six short rays and shoulders; the square portrait
  // used beside his speech in lessons has neither.
  let { size = 300, portrait = false }: { size?: number; portrait?: boolean } = $props();

  // Sun disc: centre, radius, inner ring radius. Measured separately for each use.
  const disc = $derived(portrait ? { x: 159.1, y: 171.9, r: 115.2, ring: 103 } : { x: 159.8, y: 170.9, r: 120.2, ring: 107 });
  // The beak is a little shorter in the portrait, so its tip stays inside the frame.
  const beak = $derived(
    portrait
      ? 'M206 96.4 C264 100.4 296 148.4 300 216.4 C272 168.4 242 150.4 204 148.4'
      : 'M206 96.4 C262 99 303 150 305.4 221 C272 168.4 242 150.4 204 148.4',
  );
  const rays = [
    { a: 30, long: true },
    { a: -30, long: true },
    { a: 45, long: false },
    { a: -45, long: false },
    { a: 60, long: true },
    { a: -60, long: true },
  ];
</script>

<svg
  viewBox={portrait ? '28.3 14.3 274.5 274.5' : '0 0 320 400'}
  width={size}
  height={portrait ? size : size * 1.25}
  role="img"
  aria-label="Thoth"
>
  {#if !portrait}
    <g fill="#A8431F">
      {#each rays as r (r.a)}
        {#if r.long}
          <rect x={disc.x - 4} y={disc.y - 151.4} width="8" height="20" transform="rotate({r.a} {disc.x} {disc.y})" />
        {:else}
          <rect x={disc.x - 2.75} y={disc.y - 143.3} width="5.5" height="12" transform="rotate({r.a} {disc.x} {disc.y})" />
        {/if}
      {/each}
    </g>
  {/if}
  <circle cx={disc.x} cy={disc.y} r={disc.r} fill="#E0AE3A" />
  <circle cx={disc.x} cy={disc.y} r={disc.ring} fill="none" stroke="#B5532E" stroke-width="3.2" />
  {#if !portrait}
    <path
      d="M35.4 400 L35.4 352 Q36 304 96 297 L223 297 Q283 304 283.6 352 L283.6 400 Z"
      fill="#1F1A14"
      stroke="var(--thoth-outline)"
      stroke-width="1.5"
    />
  {/if}
  <path
    d="M96 318.4 L96 146.4 Q98 80.4 160 78.4 Q176 78.4 188 88 L150 126.4 L150 318.4 Z"
    fill="#14513F"
    stroke="#1F1A14"
    stroke-width="4"
    stroke-linejoin="round"
  />
  <path d="M98 178.5 H147 M98 206.5 H147 M98 234.5 H147 M98 262.5 H147" stroke="#E0AE3A" stroke-width="4" />
  <path d="M146 146 L190.4 146 L190.4 320 L146 320 Z" fill="#1F1A14" />
  {#if !portrait}
    <path d="M58.3 400 A109.7 109.7 0 0 1 277.7 400 Z" fill="#1F1A14" />
    <path
      d="M64 400 A104 104 0 0 1 272 400 M89 400 A79 79 0 0 1 247 400 M114 400 A54 54 0 0 1 222 400"
      fill="none"
      stroke="#E0AE3A"
      stroke-width="3.5"
    />
  {/if}
  <circle cx="170" cy="126.4" r="46" fill="#1F1A14" />
  <path d="{beak} Z" fill="#1F1A14" />
  <path d={beak} fill="none" stroke="var(--thoth-outline)" stroke-width="1.5" />
  <path d="M166 116.4 Q181 103.4 197 116.4 Q181 127.4 166 116.4 Z" fill="#FBF4E2" />
  <circle cx="182" cy="115.4" r="4.5" fill="#1F1A14" />
  <path d="M166 116.4 L146 119.4" stroke="#FBF4E2" stroke-width="3" stroke-linecap="round" />
  {#if portrait}
    <path
      d="M122.8 36.3 A39 39 0 0 0 200.8 36.3 A42.8 27.9 0 0 1 122.8 36.3 Z"
      fill="#FBF4E2"
      stroke="#1F1A14"
      stroke-width="3.7"
      stroke-linejoin="round"
    />
    <circle cx="161.8" cy="33.9" r="17" fill="#C99A2E" stroke="#1F1A14" stroke-width="3.7" />
  {:else}
    <path
      d="M120.2 34.5 A42 42 0 0 0 204.2 34.5 A46 30 0 0 1 120.2 34.5 Z"
      fill="#FBF4E2"
      stroke="#1F1A14"
      stroke-width="4"
      stroke-linejoin="round"
    />
    <circle cx="162.3" cy="32" r="19" fill="#C99A2E" stroke="#1F1A14" stroke-width="4" />
  {/if}
</svg>

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
