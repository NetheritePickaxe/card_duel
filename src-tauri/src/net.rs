use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};

fn is_private(ip: &Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}

/// 可用的主机地址：排除环回/组播/未指定，以及子网掩码（全 0 全 255）等垃圾
fn is_usable(ip: &Ipv4Addr) -> bool {
    !ip.is_loopback()
        && !ip.is_multicast()
        && !ip.is_unspecified()
        && ip.octets().iter().any(|o| *o != 0 && *o != 255)
}

/// Enumerate non-loopback IPv4 addresses (default-route interface first)
pub fn local_ips() -> Vec<String> {
    let mut ips: HashSet<String> = HashSet::new();
    let mut best: Option<String> = None;

    // UDP 选路（不实际发包，离线也可用）：列出各网卡真实出口地址。连 8.8.8.8 拿到的是
    // “默认路由”网卡 IP，即局域网内其他设备真正能访问到本机的那个地址。
    for (suffix, is_best) in [
        ("255.255.255.255:0", false),
        ("224.0.0.251:5353", false),
        ("8.8.8.8:80", true),
    ] {
        if let Ok(soc) = UdpSocket::bind("0.0.0.0:0") {
            if soc.connect(suffix).is_ok() {
                if let Ok(name) = soc.local_addr() {
                    if let IpAddr::V4(ip) = name.ip() {
                        if is_usable(&ip) {
                            let s = ip.to_string();
                            if is_best {
                                best = Some(s.clone());
                            }
                            ips.insert(s);
                        }
                    }
                }
            }
        }
    }

    // 双 Windows: 解析 ipconfig，只收内网/私有地址，规避子网掩码（255.255.255.0）等噪声。
    {
        if let Ok(out) = std::process::Command::new("ipconfig").output() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                for part in line.split_whitespace() {
                    if let Ok(ip) = part.parse::<Ipv4Addr>() {
                        if is_private(&ip) {
                            ips.insert(ip.to_string());
                        }
                    }
                }
            }
        }
    }

    let mut list: Vec<String> = ips.into_iter().collect();
    // 默认路由网卡 IP 放最前
    if let Some(b) = &best {
        if let Some(pos) = list.iter().position(|x| x == b) {
            list.remove(pos);
            list.insert(0, b.clone());
        }
    } else {
        // 无默认路由信息时，内网优先排序
        list.sort_by_key(|ip| {
            !(ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172."))
        });
    }
    list
}

/// Get the best LAN IP for phones to connect (default-route interface first)
pub fn lan_ip() -> String {
    local_ips()
        .first()
        .cloned()
        .unwrap_or_else(|| "127.0.0.1".to_string())
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
