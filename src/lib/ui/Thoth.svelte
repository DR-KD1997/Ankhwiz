<script lang="ts" module>
  /** A short one-off movement. Pass a new id to play it again. */
  export type Reaction = 'nod' | 'happy' | 'cheer' | 'sad' | 'delight' | 'encourage';
  export interface Cue {
    kind: Reaction;
    id: number;
  }
</script>

<script lang="ts">
  // Thoth, final concept, traced from the approved artwork: profile against a
  // gold sun disc, emerald headdress, crescent and sphere crown.
  // The full figure has six short rays and shoulders; the square portrait
  // used beside his speech in lessons has neither.
  //
  // Movement: an idle loop (breathing, blinking, glancing, the sun's rays and
  // the crown's sphere glinting) in CSS, and one-off reactions (nod, happy,
  // cheer, sad) played with the Web Animations API so they can be repeated.
  // Everything stops for "reduce motion" and when Settings turns it off.
  import { untrack } from 'svelte';
  import { data } from '../store.svelte';

  let {
    size = 300,
    portrait = false,
    mood = 'idle',
    cue = null,
    nodOn = undefined,
  }: {
    size?: number;
    portrait?: boolean;
    /** 'think' while waiting for an AI reply. */
    mood?: 'idle' | 'think';
    /** A reaction to play. */
    cue?: Cue | null;
    /** Any value: he nods whenever it changes (for example his speech). */
    nodOn?: unknown;
  } = $props();

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

  // Each Thoth on screen keeps his own rhythm.
  const delay = `${-(Math.random() * 8).toFixed(2)}s`;
  const blink = `${(5 + Math.random() * 3).toFixed(2)}s`;
  const eyeClip = `thoth-eye-${Math.random().toString(36).slice(2, 9)}`;
  const EYE = 'M166 116.4 Q181 103.4 197 116.4 Q181 127.4 166 116.4 Z';

  let reduced = $state(false);
  $effect(() => {
    const q = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!q) return;
    reduced = q.matches;
    const on = () => (reduced = q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  });
  const still = $derived(reduced || data.settings.motion === false);

  let whole = $state<SVGGElement>();
  let head = $state<SVGGElement>();
  let lid = $state<SVGGElement>();
  let glow = $state<SVGCircleElement>();
  let flare = $state<SVGGElement>();
  let ponder = $state<SVGGElement>();

  // Rotations and scales are written around an explicit point, in the
  // drawing's own units, so they behave the same in every web view.
  const around = (x: number, y: number, t: string) => `translate(${x}px, ${y}px) ${t} translate(${-x}px, ${-y}px)`;
  const NECK = { x: 165, y: 140 };
  let ponderAngle = 0;
  // Every keyframe of one movement uses the same list of steps; blending
  // between different lists slides the pivot and makes parts jump.
  const lidAt = (s: number) => ({ transform: around(181.5, 116.4, `scaleY(${s})`) });
  const tilt = (deg: number) => ({ transform: around(NECK.x, NECK.y, `rotate(${deg}deg)`) });

  function play(kind: Reaction) {
    if (still || !head) return;
    const ease = { easing: 'cubic-bezier(.3,.7,.4,1)' };
    if (kind === 'nod') {
      head.animate([tilt(0), tilt(6), tilt(0)], { duration: 520, ...ease });
    } else if (kind === 'happy') {
      head.animate([tilt(0), tilt(7), tilt(-2), tilt(6), tilt(0)], { duration: 820, ...ease });
      shine(0.8, 900);
      spread(1.1, 0, 900);
    } else if (kind === 'cheer') {
      whole?.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-12px)' }, { transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' }],
        { duration: 1000, easing: 'cubic-bezier(.45,0,.25,1)' },
      );
      head.animate([tilt(0), tilt(-6), tilt(0), tilt(-3), tilt(0)], { duration: 900, ...ease });
      shine(1, 1200);
      spread(1.16, 24, 1200);
    } else if (kind === 'delight') {
      // A streak milestone: eyes wide, a bigger hop, the rays turning further.
      whole?.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-16px)' }, { transform: 'translateY(0)' }, { transform: 'translateY(-7px)' }, { transform: 'translateY(0)' }],
        { duration: 1100, easing: 'cubic-bezier(.45,0,.25,1)' },
      );
      head.animate([tilt(0), tilt(-8), tilt(-8), tilt(0)], { duration: 1400, ...ease });
      lid?.animate([lidAt(1), lidAt(1.3), lidAt(1.3), lidAt(1)], { duration: 1400, easing: 'ease-in-out' });
      shine(1, 1600);
      spread(1.22, 40, 1600);
    } else if (kind === 'encourage') {
      // After a hard lesson: a slow, warm nod.
      head.animate([tilt(0), tilt(5), tilt(5), tilt(0)], { duration: 1600, easing: 'ease-in-out' });
      shine(0.5, 1800);
    } else if (kind === 'sad') {
      head.animate([tilt(0), tilt(10), tilt(10), tilt(0)], { duration: 1500, easing: 'ease-in-out' });
      lid?.animate(
        [lidAt(1), lidAt(0.55), lidAt(0.55), lidAt(1)],
        { duration: 1500, easing: 'ease-in-out' },
      );
    }
  }

  function shine(peak: number, duration: number) {
    glow?.animate([{ opacity: 0 }, { opacity: peak }, { opacity: 0 }], { duration, easing: 'ease-out' });
  }

  function spread(scale: number, turn: number, duration: number) {
    if (!flare) return;
    const t = (s: number, a: number) => ({ transform: around(disc.x, disc.y, `rotate(${a}deg) scale(${s})`) });
    flare.animate([t(1, 0), t(scale, turn / 2), t(1, turn)], { duration, easing: 'ease-out' });
  }

  // Thinking: the head eases up into a slow sway and eases back down after,
  // so it never jumps between poses.
  $effect(() => {
    const el = ponder;
    const thinking = mood === 'think' && !still;
    if (!el) return;
    let angle = untrack(() => ponderAngle);
    let last = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const target = thinking ? -3.5 + 1.5 * Math.sin((t / 2400) * Math.PI * 2) : 0;
      angle += (target - angle) * Math.min(1, dt * 5);
      ponderAngle = angle;
      el.style.transform = around(NECK.x, NECK.y, `rotate(${angle.toFixed(3)}deg)`);
      if (thinking || Math.abs(angle) > 0.02) raf = requestAnimationFrame(step);
      else el.style.transform = '';
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });

  // Only a new cue plays a reaction, not changes to what play() reads.
  $effect(() => {
    const c = cue;
    if (c) untrack(() => play(c.kind));
  });

  let lastNod: unknown = undefined;
  let firstNod = true;
  $effect(() => {
    const v = nodOn;
    if (v === undefined) return;
    if (firstNod) {
      firstNod = false;
      lastNod = v;
      return;
    }
    if (v !== lastNod) {
      lastNod = v;
      untrack(() => play('nod'));
    }
  });
</script>

<svg
  viewBox={portrait ? '28.3 14.3 274.5 274.5' : '0 0 320 400'}
  width={size}
  height={portrait ? size : size * 1.25}
  role="img"
  aria-label="Thoth"
  class:still
  class:thinking={mood === 'think'}
  style="--delay: {delay}; --blink: {blink}; --dx: {disc.x}px; --dy: {disc.y}px"
>
  <g bind:this={whole} class="move">
    {#if !portrait}
      <g bind:this={flare} class="move">
        <g fill="#A8431F">
          {#each rays as r, i (r.a)}
            <g class="ray" style="animation-delay: calc(var(--delay) - {i * 0.6}s)">
              {#if r.long}
                <rect x={disc.x - 4} y={disc.y - 151.4} width="8" height="20" transform="rotate({r.a} {disc.x} {disc.y})" />
              {:else}
                <rect x={disc.x - 2.75} y={disc.y - 143.3} width="5.5" height="12" transform="rotate({r.a} {disc.x} {disc.y})" />
              {/if}
            </g>
          {/each}
        </g>
      </g>
    {/if}
    <circle cx={disc.x} cy={disc.y} r={disc.r} fill="#E0AE3A" />
    <circle class="warm" cx={disc.x} cy={disc.y} r={disc.r} fill="#F4C24A" />
    <circle bind:this={glow} cx={disc.x} cy={disc.y} r={disc.r} fill="#F7CB52" opacity="0" />
    <circle cx={disc.x} cy={disc.y} r={disc.ring} fill="none" stroke="#B5532E" stroke-width="3.2" />
    {#if !portrait}
      <path
        class="breathe"
        d="M35.4 400 L35.4 352 Q36 304 96 297 L223 297 Q283 304 283.6 352 L283.6 400 Z"
        fill="#1F1A14"
        stroke="var(--thoth-outline)"
        stroke-width="1.5"
      />
    {/if}
    <g class="bob">
      <path
        d="M96 318.4 L96 146.4 Q98 80.4 160 78.4 Q176 78.4 188 88 L150 126.4 L150 318.4 Z"
        fill="#14513F"
        stroke="#1F1A14"
        stroke-width="4"
        stroke-linejoin="round"
      />
      <path d="M98 178.5 H147 M98 206.5 H147 M98 234.5 H147 M98 262.5 H147" stroke="#E0AE3A" stroke-width="4" />
      <path d="M146 146 L190.4 146 L190.4 320 L146 320 Z" fill="#1F1A14" />
    </g>
    {#if !portrait}
      <path d="M58.3 400 A109.7 109.7 0 0 1 277.7 400 Z" fill="#1F1A14" />
      <path
        d="M64 400 A104 104 0 0 1 272 400 M89 400 A79 79 0 0 1 247 400 M114 400 A54 54 0 0 1 222 400"
        fill="none"
        stroke="#E0AE3A"
        stroke-width="3.5"
      />
    {/if}
    <g class="bob">
      <g bind:this={ponder} class="ponder">
        <g bind:this={head} class="move">
          <circle cx="170" cy="126.4" r="46" fill="#1F1A14" />
          <path d="{beak} Z" fill="#1F1A14" />
          <path d={beak} fill="none" stroke="var(--thoth-outline)" stroke-width="1.5" />
          <g bind:this={lid} class="move">
            <g class="blink">
              <clipPath id={eyeClip}><path d={EYE} /></clipPath>
              <path d={EYE} fill="#FBF4E2" />
              <g clip-path="url(#{eyeClip})"><g class="gaze"><circle class="pupil" cx="182" cy="115.4" r="4.5" fill="#1F1A14" /></g></g>
              <path d="M166 116.4 L146 119.4" stroke="#FBF4E2" stroke-width="3" stroke-linecap="round" />
            </g>
          </g>
          {#if portrait}
            <path
              d="M122.8 36.3 A39 39 0 0 0 200.8 36.3 A42.8 27.9 0 0 1 122.8 36.3 Z"
              fill="#FBF4E2"
              stroke="#1F1A14"
              stroke-width="3.7"
              stroke-linejoin="round"
            />
            <circle cx="161.8" cy="33.9" r="17" fill="#C99A2E" stroke="#1F1A14" stroke-width="3.7" />
            <circle class="glint" cx="155.8" cy="27.9" r="5" fill="#FFF3CC" />
          {:else}
            <path
              d="M120.2 34.5 A42 42 0 0 0 204.2 34.5 A46 30 0 0 1 120.2 34.5 Z"
              fill="#FBF4E2"
              stroke="#1F1A14"
              stroke-width="4"
              stroke-linejoin="round"
            />
            <circle cx="162.3" cy="32" r="19" fill="#C99A2E" stroke="#1F1A14" stroke-width="4" />
            <circle class="glint" cx="155.8" cy="25.5" r="5.5" fill="#FFF3CC" />
          {/if}
        </g>
      </g>
    </g>
  </g>
</svg>

<style>
  svg {
    display: block;
    flex: none;
    overflow: visible;
  }
  /* Transforms are written around explicit points in drawing units. */
  .move,
  .bob,
  .ponder,
  .blink,
  .gaze,
  .pupil,
  .breathe {
    transform-box: view-box;
    transform-origin: 0 0;
  }

  /* Idle: a slow rise and fall of head and headdress. */
  .bob {
    animation: bob 5.2s ease-in-out infinite var(--delay);
  }
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-2.2px);
    }
  }
  .breathe {
    animation: breathe 5.2s ease-in-out infinite var(--delay);
  }
  @keyframes breathe {
    0%,
    100% {
      transform: translate(0, 400px) scaleY(1) translate(0, -400px);
    }
    50% {
      transform: translate(0, 400px) scaleY(1.015) translate(0, -400px);
    }
  }

  /* Blinking: the eye closes for a moment every few seconds. */
  .blink {
    animation: blink var(--blink) linear infinite var(--delay);
  }
  @keyframes blink {
    0%,
    92%,
    96.5%,
    100% {
      transform: translate(181.5px, 116.4px) scaleY(1) translate(-181.5px, -116.4px);
    }
    94% {
      transform: translate(181.5px, 116.4px) scaleY(0.08) translate(-181.5px, -116.4px);
    }
  }
  .pupil {
    animation: glance 11s ease-in-out infinite var(--delay);
  }
  @keyframes glance {
    0%,
    38%,
    100% {
      transform: translate(0, 0);
    }
    42%,
    56% {
      transform: translate(-3.5px, 0.5px);
    }
    62%,
    74% {
      transform: translate(0, 0);
    }
    78%,
    88% {
      transform: translate(2.5px, -0.5px);
    }
  }

  /* The sun: rays shimmer in turn and the disc warms and cools. */
  .ray {
    animation: shimmer 3.6s ease-in-out infinite;
  }
  @keyframes shimmer {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
  .warm {
    opacity: 0;
    animation: warm 7s ease-in-out infinite var(--delay);
  }
  @keyframes warm {
    0%,
    100% {
      opacity: 0;
    }
    50% {
      opacity: 0.5;
    }
  }
  /* The crown's sphere catches the light. */
  .glint {
    opacity: 0;
    animation: glint 6s ease-in-out infinite var(--delay);
  }
  @keyframes glint {
    0%,
    70%,
    100% {
      opacity: 0;
    }
    80% {
      opacity: 0.85;
    }
  }

  /* Thinking: head raised a little, eyes up, the sphere glowing faster. */
  .gaze {
    transition: transform 0.5s ease;
  }
  .thinking .gaze {
    transform: translate(2px, -2px);
  }
  .thinking .glint {
    animation-duration: 1.4s;
  }

  .still *,
  .still {
    animation: none !important;
  }
  .still .warm,
  .still .glint {
    opacity: 0;
  }
</style>
