//! UTC timestamps for backup names and file dates, without a date library: the format needs only
//! the civil calendar, and a light crate is easier to audit.

use std::time::{SystemTime, UNIX_EPOCH};

/// A moment in UTC with one-second precision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Utc {
    pub year: i64,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

impl Utc {
    pub fn from_system(time: SystemTime) -> Self {
        // Moments before 1970 do not occur for files HErPlan writes; clamp them to the epoch.
        let secs = time
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
        let rem = secs.rem_euclid(86_400) as u32;
        Self {
            year,
            month,
            day,
            hour: rem / 3600,
            minute: rem % 3600 / 60,
            second: rem % 60,
        }
    }

    pub fn now() -> Self {
        Self::from_system(SystemTime::now())
    }

    /// ISO 8601, as stored in project files: `2026-10-18T09:40:00Z`.
    pub fn iso(&self) -> String {
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )
    }

    /// The same moment as a file name (no colons, which Windows forbids): `2026-10-18T09-40-00Z`.
    pub fn file_stamp(&self) -> String {
        format!(
            "{:04}-{:02}-{:02}T{:02}-{:02}-{:02}Z",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )
    }

    /// Parses a [`Utc::file_stamp`]; anything else returns `None`.
    pub fn parse_file_stamp(stamp: &str) -> Option<Self> {
        let b = stamp.as_bytes();
        if b.len() != 20 || b[19] != b'Z' || b[10] != b'T' {
            return None;
        }
        let dashes = [4, 7, 13, 16];
        if dashes.iter().any(|&i| b[i] != b'-') {
            return None;
        }
        let num = |from: usize, to: usize| -> Option<u32> {
            let part = &stamp[from..to];
            part.bytes()
                .all(|c| c.is_ascii_digit())
                .then(|| part.parse().ok())
                .flatten()
        };
        let utc = Self {
            year: i64::from(num(0, 4)?),
            month: num(5, 7)?,
            day: num(8, 10)?,
            hour: num(11, 13)?,
            minute: num(14, 16)?,
            second: num(17, 19)?,
        };
        let valid = (1..=12).contains(&utc.month)
            && (1..=31).contains(&utc.day)
            && utc.hour < 24
            && utc.minute < 60
            && utc.second < 61;
        valid.then_some(utc)
    }
}

/// Converts days since 1970-01-01 to (year, month, day) in the proleptic Gregorian calendar.
/// Howard Hinnant's algorithm: <https://howardhinnant.github.io/date_algorithms.html#civil_from_days>.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Milliseconds since the Unix epoch, as JavaScript dates count them.
pub(crate) fn unix_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn at(secs: u64) -> Utc {
        Utc::from_system(UNIX_EPOCH + Duration::from_secs(secs))
    }

    #[test]
    fn formats_known_moments() {
        assert_eq!(at(0).iso(), "1970-01-01T00:00:00Z");
        // 2026-10-18T09:40:00Z
        assert_eq!(at(1_792_316_400).iso(), "2026-10-18T09:40:00Z");
        assert_eq!(at(1_792_316_400).file_stamp(), "2026-10-18T09-40-00Z");
        // Leap day and the end of a leap year.
        assert_eq!(at(951_782_400).iso(), "2000-02-29T00:00:00Z");
        assert_eq!(at(1_735_689_599).iso(), "2024-12-31T23:59:59Z");
    }

    #[test]
    fn parses_file_stamps() {
        let utc = Utc::parse_file_stamp("2026-10-18T09-40-00Z").unwrap();
        assert_eq!(utc.iso(), "2026-10-18T09:40:00Z");
        for bad in [
            "",
            "2026-10-18T09:40:00Z",
            "2026-13-18T09-40-00Z",
            "2026-10-18T24-40-00Z",
            "2026-10-18T09-40-00",
            "2026-10-18T09-40-00Z-2",
            "+026-10-18T09-40-00Z",
            "notes",
        ] {
            assert!(Utc::parse_file_stamp(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn converts_to_unix_ms() {
        assert_eq!(unix_ms(UNIX_EPOCH + Duration::from_millis(1234)), 1234);
        assert_eq!(unix_ms(UNIX_EPOCH - Duration::from_secs(1)), 0);
    }
}
