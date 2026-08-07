use std::collections::HashSet;
use std::net::{IpAddr, UdpSocket};

/// Enumerate non-loopback IPv4 addresses
pub fn local_ips() -> Vec<String> {
    let mut ips = HashSet::new();

    // UDP socket approach
    for suffix in ["255.255.255.255", "224.0.0.251"] {
        if let Ok(soc) = UdpSocket::bind("0.0.0.0:0") {
            if soc.connect(suffix).is_ok() {
                if let Ok(name) = soc.local_addr() {
                    let ip = name.ip();
                    if matches!(ip, IpAddr::V4(v) if !v.is_loopback() && !v.is_multicast()) {
                        ips.insert(ip.to_string());
                    }
                }
            }
        }
    }

    // Windows: parse ipconfig output
    #[cfg(windows)]
    {
        if let Ok(out) = std::process::Command::new("ipconfig").output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                for part in line.split_whitespace() {
                    if let Ok(ip) = part.parse::<std::net::Ipv4Addr>() {
                        if !ip.is_loopback() && !ip.is_multicast() && !ip.is_unspecified() {
                            ips.insert(ip.to_string());
                        }
                    }
                }
            }
        }
    }

    // Sort: LAN first
    let mut ips: Vec<String> = ips.into_iter().collect();
    ips.sort_by_key(|ip| {
        !(ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172."))
    });
    ips
}

/// Virtual network prefixes to skip when choosing the best LAN IP
#[cfg(windows)]
const VIRTUAL_NET_PREFIXES: &[&str] = &[
    "192.168.182.",
    "192.168.9.",
    "192.168.56.",
    "192.168.137.",
    "169.254.",
];

/// Get the best LAN IP for phones to connect
pub fn lan_ip() -> String {
    #[cfg(windows)]
    {
        if let Some(ip) = parse_ipconfig_for_best_ip() {
            return ip;
        }
    }

    // Fallback: first non-loopback
    let ips = local_ips();
    ips.first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

#[cfg(windows)]
fn parse_ipconfig_for_best_ip() -> Option<String> {
    let out = std::process::Command::new("ipconfig").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = text.lines().collect();

    let mut blocks: Vec<Vec<&str>> = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    for ln in &lines {
        if ln.trim().is_empty() {
            if !cur.is_empty() {
                blocks.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(ln);
        }
    }
    if !cur.is_empty() {
        blocks.push(cur);
    }

    let mut gw: Vec<String> = Vec::new();
    let mut cands: Vec<String> = Vec::new();

    for blk in &blocks {
        let mut ip: Option<String> = None;
        let mut has_gw = false;
        for ln in blk {
            for part in ln.split_whitespace() {
                if let Ok(parsed) = part.parse::<std::net::Ipv4Addr>() {
                    if !parsed.is_loopback() && !parsed.is_multicast() && ip.is_none() {
                        ip = Some(parsed.to_string());
                    }
                }
            }
            if ln.contains("默认网关") {
                has_gw = true;
            }
        }
        if let Some(ip) = ip {
            cands.push(ip.clone());
            if has_gw {
                gw.push(ip);
            }
        }
    }

    // Prefer gateway IPs on LAN subnets
    for ip in &gw {
        if ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172.") {
            return Some(ip.clone());
        }
    }
    if !gw.is_empty() {
        return Some(gw[0].clone());
    }

    // Skip virtual network prefixes
    for ip in &cands {
        let is_lan = ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172.");
        if is_lan && !VIRTUAL_NET_PREFIXES.iter().any(|b| ip.starts_with(b)) {
            return Some(ip.clone());
        }
    }
    cands.first().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_ips_not_empty() {
        let ips = local_ips();
        assert!(!ips.is_empty(), "Should detect at least one IP");
        assert!(
            !ips.contains(&"127.0.0.1".to_string()),
            "Should not include loopback"
        );
    }

    #[test]
    fn test_lan_ip_valid() {
        let ip = lan_ip();
        assert!(!ip.is_empty(), "Should return a valid IP");
        assert!(
            ip.parse::<std::net::Ipv4Addr>().is_ok(),
            "IP should be valid: {}",
            ip
        );
    }
}
