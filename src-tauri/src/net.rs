use std::net::{IpAddr, Ipv4Addr, UdpSocket};

/// Enumerate non-loopback IPv4 addresses (mirrors Python local_ips())
pub fn local_ips() -> Vec<String> {
    let mut ips: Vec<String> = Vec::new();

    // UDP socket approach
    for suffix in ["255.255.255.255", "224.0.0.251"] {
        if let Ok(soc) = UdpSocket::bind("0.0.0.0:0") {
            if soc.connect(suffix).is_ok() {
                if let Ok(name) = soc.local_addr() {
                    let ip = name.ip();
                    if matches!(ip, IpAddr::V4(v) if !v.is_loopback() && !v.is_multicast()) {
                        if !ips.contains(&ip.to_string()) {
                            ips.push(ip.to_string());
                        }
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
                    if let Ok(ip) = part.parse::<Ipv4Addr>() {
                        if !ip.is_loopback() && !ip.is_multicast() && !ip.is_unspecified() {
                            if !ips.contains(&ip.to_string()) {
                                ips.push(ip.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort: LAN first
    let mut lan: Vec<String> = ips.iter()
        .filter(|i| i.starts_with("192.168.") || i.starts_with("10.") || i.starts_with("172."))
        .cloned()
        .collect();
    let mut other: Vec<String> = ips.iter()
        .filter(|i| !i.starts_with("192.168.") && !i.starts_with("10.") && !i.starts_with("172."))
        .cloned()
        .collect();
    lan.append(&mut other);
    lan
}

/// Get the best LAN IP for phones to connect (mirrors Python lan_ip())
pub fn lan_ip() -> String {
    #[cfg(windows)]
    {
        if let Ok(out) = std::process::Command::new("ipconfig").output() {
            let text = String::from_utf8_lossy(&out.stdout);
            let lines: Vec<&str> = text.lines().collect();
            let mut blocks: Vec<Vec<&str>> = Vec::new();
            let mut cur: Vec<&str> = Vec::new();
            for ln in lines {
                if ln.trim().is_empty() {
                    if !cur.is_empty() {
                        blocks.push(cur.clone());
                        cur.clear();
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
                        if let Ok(parsed) = part.parse::<Ipv4Addr>() {
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
            for ip in &gw {
                if ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172.") {
                    return ip.clone();
                }
            }
            if !gw.is_empty() {
                return gw[0].clone();
            }
            let bad = ["192.168.182.", "192.168.9.", "192.168.56.", "192.168.137.", "169.254."];
            for ip in &cands {
                if ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172.") {
                    let is_bad = bad.iter().any(|b| ip.starts_with(b));
                    if !is_bad {
                        return ip.clone();
                    }
                }
            }
            if !cands.is_empty() {
                return cands[0].clone();
            }
        }
    }

    // Fallback: first non-loopback
    let ips = local_ips();
    ips.first().cloned().unwrap_or_else(|| "127.0.0.1".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_ips_not_empty() {
        let ips = local_ips();
        assert!(!ips.is_empty(), "Should detect at least one IP");
        assert!(!ips.contains(&"127.0.0.1".to_string()), "Should not include loopback");
    }

    #[test]
    fn test_lan_ip_valid() {
        let ip = lan_ip();
        assert!(!ip.is_empty(), "Should return a valid IP");
        assert!(ip.parse::<Ipv4Addr>().is_ok(), "IP should be valid: {}", ip);
    }
}
