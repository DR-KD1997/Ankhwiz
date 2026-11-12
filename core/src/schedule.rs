//! Scheduling with FSRS, long-term mode: every review is scheduled in whole
//! days, the way the `rs-fsrs` long-term scheduler does it.
//! When Anki's engine is attached, it takes over this module's job.

use crate::model::{Clock, Memory, DAY_MS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grade {
    Again,
    Hard,
    Good,
    Easy,
}

impl Grade {
    pub fn as_str(self) -> &'static str {
        match self {
            Grade::Again => "again",
            Grade::Hard => "hard",
            Grade::Good => "good",
            Grade::Easy => "easy",
        }
    }
}

/// The FSRS formulas and default weights, taken from the `rs-fsrs` crate
/// (MIT licence, (c) 2023 Open Spaced Repetition; see THIRD-PARTY.md).
/// They are copied rather than linked because the crate reads the system
/// clock, which the WebAssembly build does not have.
mod fsrs {
    pub const W: [f64; 19] = [
        0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824,
        1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466, 0.5034, 0.6567,
    ];
    pub const DECAY: f64 = -0.5;
    /// (9/10) ^ (1 / DECAY) - 1
    pub const FACTOR: f64 = 19.0 / 81.0;

    /// Ratings are 1 Again, 2 Hard, 3 Good, 4 Easy.
    pub fn forgetting_curve(elapsed_days: f64, stability: f64) -> f64 {
        (1.0 + FACTOR * elapsed_days / stability).powf(DECAY)
    }

    pub fn init_difficulty(rating: u8) -> f64 {
        (W[4] - f64::exp(W[5] * (rating as f64 - 1.0)) + 1.0).clamp(1.0, 10.0)
    }

    pub fn init_stability(rating: u8) -> f64 {
        W[(rating - 1) as usize].max(0.1)
    }

    pub fn next_interval(stability: f64, retention: f64, maximum: f64) -> f64 {
        (stability / FACTOR * (retention.powf(1.0 / DECAY) - 1.0)).round().clamp(1.0, maximum.max(1.0))
    }

    pub fn next_difficulty(difficulty: f64, rating: u8) -> f64 {
        let next = W[6].mul_add(-(rating as f64 - 3.0), difficulty);
        W[7].mul_add(init_difficulty(4), (1.0 - W[7]) * next).clamp(1.0, 10.0)
    }

    pub fn next_recall_stability(difficulty: f64, stability: f64, retrievability: f64, rating: u8) -> f64 {
        let modifier = match rating {
            2 => W[15],
            4 => W[16],
            _ => 1.0,
        };
        stability
            * ((W[8].exp() * (11.0 - difficulty) * stability.powf(-W[9]) * ((1.0 - retrievability) * W[10]).exp_m1())
                .mul_add(modifier, 1.0))
    }

    pub fn next_forget_stability(difficulty: f64, stability: f64, retrievability: f64) -> f64 {
        W[11] * difficulty.powf(-W[12]) * ((stability + 1.0).powf(W[13]) - 1.0) * f64::exp((1.0 - retrievability) * W[14])
    }
}

const RATINGS: [u8; 4] = [1, 2, 3, 4];

pub struct Scheduled {
    pub mem: Memory,
    /// Interval in whole days.
    pub days: i64,
    /// Due time in milliseconds.
    pub due: f64,
}

/// Record one graded answer. Mirrors the crate's long-term scheduler:
/// compute all four outcomes, keep their intervals in order, return one.
/// Scheduler settings a deck can change.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub retention: f64,
    pub max_interval: f64,
}

impl Default for Limits {
    fn default() -> Self {
        Self { retention: 0.9, max_interval: 36500.0 }
    }
}

pub fn review(mem: Option<Memory>, grade: Grade, clock: Clock) -> Scheduled {
    review_with(mem, grade, clock, Limits::default())
}

pub fn review_with(mem: Option<Memory>, grade: Grade, clock: Clock, limits: Limits) -> Scheduled {
    let retention = limits.retention.clamp(0.7, 0.99);
    let today = clock.day();
    let mut next: Vec<(f64, f64)> = Vec::with_capacity(4); // (stability, difficulty)
    let mut elapsed = 0i64;
    let _ = elapsed;
    match mem {
        None => {
            for r in RATINGS {
                next.push((fsrs::init_stability(r), fsrs::init_difficulty(r)));
            }
        }
        Some(m) => {
            elapsed = (today - m.last_day).max(0);
            let retrievability = fsrs::forgetting_curve(elapsed as f64, m.stability);
            for r in RATINGS {
                let difficulty = fsrs::next_difficulty(m.difficulty, r);
                let stability = match r {
                    1 => fsrs::next_forget_stability(m.difficulty, m.stability, retrievability),
                    _ => fsrs::next_recall_stability(m.difficulty, m.stability, retrievability, r),
                };
                next.push((stability, difficulty));
            }
        }
    }
    let mut days: Vec<f64> = next.iter().map(|(s, _)| fsrs::next_interval(*s, retention, limits.max_interval)).collect();
    days[0] = days[0].min(days[1]);
    days[1] = days[1].max(days[0] + 1.0);
    days[2] = days[2].max(days[1] + 1.0);
    days[3] = days[3].max(days[2] + 1.0);
    // The ordering above can push past the longest gap; the limit wins.
    for d in days.iter_mut() {
        *d = d.min(limits.max_interval.max(1.0));
    }

    let i = match grade {
        Grade::Again => 0,
        Grade::Hard => 1,
        Grade::Good => 2,
        Grade::Easy => 3,
    };
    let interval = days[i] as i64;
    Scheduled {
        mem: Memory { stability: next[i].0, difficulty: next[i].1, last_day: today },
        days: interval,
        due: clock.now + interval as f64 * DAY_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn better_grades_earn_longer_intervals() {
        let clock = Clock::new(1_800_000_000_000.0, 120.0);
        let days: Vec<i64> = [Grade::Again, Grade::Hard, Grade::Good, Grade::Easy]
            .iter()
            .map(|g| review(None, *g, clock).days)
            .collect();
        assert!(days[0] >= 1);
        assert!(days.windows(2).all(|w| w[0] < w[1]), "{days:?}");
    }

    #[test]
    fn intervals_grow_with_repeated_success() {
        let mut clock = Clock::new(1_800_000_000_000.0, 0.0);
        let mut s = review(None, Grade::Good, clock);
        let first = s.days;
        for _ in 0..3 {
            clock.now = s.due;
            s = review(Some(s.mem), Grade::Good, clock);
        }
        assert!(s.days > first * 3, "{} vs {}", s.days, first);
    }

    #[test]
    fn higher_retention_means_shorter_gaps() {
        let clock = Clock::new(1_800_000_000_000.0, 0.0);
        let first = review(None, Grade::Good, clock);
        let later = Clock::new(first.due, 0.0);
        let relaxed = review_with(Some(first.mem), Grade::Good, later, Limits { retention: 0.8, max_interval: 36500.0 });
        let strict = review_with(Some(first.mem), Grade::Good, later, Limits { retention: 0.95, max_interval: 36500.0 });
        assert!(strict.days < relaxed.days, "{} vs {}", strict.days, relaxed.days);
        let capped = review_with(Some(first.mem), Grade::Easy, later, Limits { retention: 0.8, max_interval: 3.0 });
        assert!(capped.days <= 3, "{}", capped.days);
    }

    #[test]
    fn a_lapse_shortens_the_interval() {
        let mut clock = Clock::new(1_800_000_000_000.0, 0.0);
        let mut s = review(None, Grade::Good, clock);
        clock.now = s.due;
        s = review(Some(s.mem), Grade::Good, clock);
        let before = s.days;
        clock.now = s.due;
        let lapsed = review(Some(s.mem), Grade::Again, clock);
        assert!(lapsed.days < before);
    }
}
