# Cloudflare DDoS Protection Setup for NEOP

## Why Cloudflare?

NEOP is an election platform that may face:
- **100M+ concurrent viewers** during election day
- **Nation-state DDoS attacks** targeting election infrastructure
- **API abuse** from scrapers and bots
- **Volumetric attacks** (SYN floods, UDP amplification)

Cloudflare provides **free** L3/L4/L7 DDoS protection, plus:
- Global CDN (300+ edge locations)
- Under Attack Mode (JS challenge for suspicious traffic)
- Rate limiting at the edge
- WAF rules for common attack patterns
- SSL/TLS termination

## Step-by-Step Setup

### 1. Register a Domain

You need a custom domain. Options:
- `ngeop.ng` (Nigerian TLD — more local credibility)
- `votewatch.ng` (descriptive name)
- `ngeop.org` (if you're a non-profit)

Register at [Namecheap](https://namecheap.com), [GoDaddy](https://godaddy.com), or any registrar.

### 2. Add Domain to Cloudflare

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **"Add a Site"**
3. Enter your domain (e.g., `ngeop.ng`)
4. Select **Free** plan (DDoS protection is included free)
5. Cloudflare will scan existing DNS records

### 3. Configure DNS Records

Add these DNS records in Cloudflare:

| Type | Name | Content | Proxy Status | TTL |
|------|------|---------|--------------|-----|
| CNAME | `@` | `cname.vercel-dns.com` | 🟠 Proxied | Auto |
| CNAME | `www` | `cname.vercel-dns.com` | 🟠 Proxied | Auto |
| CNAME | `ngeop` | `cname.vercel-dns.com` | 🟠 Proxied | Auto |

**Important:** The 🟠 orange cloud (Proxied) is what enables Cloudflare's DDoS protection.

### 4. Update Vercel Domain Settings

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard) → NEOP project
2. Go to **Settings → Domains**
3. Add your domain (e.g., `ngeop.ng`)
4. Add `www.ngeop.ng`
5. Set `ngeop.ng` as the primary domain

Vercel will show you the DNS records to configure — they should match what you set in Cloudflare.

### 5. Update Nameservers

At your domain registrar (Namecheap, GoDaddy, etc.):

1. Find the **Nameserver** settings
2. Replace the default nameservers with Cloudflare's:
   ```
   ns1.cloudflare.com
   ns2.cloudflare.com
   ```
3. Wait 24-48 hours for propagation (usually faster)

### 6. Configure Cloudflare Security Settings

In Cloudflare Dashboard → your domain → **Security**:

#### SSL/TLS Settings
- **SSL/TLS encryption mode:** Full (Strict)
- **Always Use HTTPS:** On
- **Automatic HTTPS Rewrites:** On
- **Minimum TLS version:** TLS 1.2

#### Security Level
- **Security Level:** Medium
- **Challenge Passage:** 30 minutes

#### Bots
- **Bot Fight Mode:** On
- **Fight hotlinked bots & scrapers:** On

#### DDoS
- **DDoS Protection:** Auto (always on)
- **HTTP DDoS attack protection:** On
- **HTTP flood protection:** On

#### WAF (Web Application Firewall)
- **Cloudflare Managed Ruleset:** On
- **Cloudflare OWASP Core Ruleset:** On
- **Rate Limiting Rules:** Create the following:

**Rule 1: API Rate Limit (per IP)**
```
When: (http.request.uri.path contains "/api/")
Then: Rate limit
Rate: 100 requests / 1 minute
Mitigation timeout: 600 seconds
```

**Rule 2: Auth Endpoint Protection**
```
When: (http.request.uri.path contains "/api/auth")
Then: Rate limit
Rate: 10 requests / 1 minute
Mitigation timeout: 900 seconds
```

**Rule 3: Simulation Endpoint**
```
When: (http.request.uri.path contains "/api/admin/simulate")
Then: Rate limit
Rate: 5 requests / 1 minute
Mitigation timeout: 3600 seconds
```

#### Page Rules
**Rule 1: Cache Public API**
```
URL: ngeop.ng/api/public/*
Settings: Cache Level: Cache Everything, Edge Cache TTL: 1 minute
```

**Rule 2: Cache Homepage**
```
URL: ngeop.ng/
Settings: Cache Level: Cache Everything, Edge Cache TTL: 5 minutes
```

### 7. Enable Under Attack Mode (Election Day Only)

On election day or during anticipated high traffic:

1. Cloudflare Dashboard → Security → Settings
2. Set **Security Level** to **I'm Under Attack!**
3. This adds a JavaScript challenge page for suspicious traffic
4. Real users see a brief (5-second) interstitial page
5. Bots and DDoS traffic are blocked

**Remember to turn it off after the event** — it adds latency for legitimate users.

### 8. Enable Cloudflare Workers (Optional Advanced Protection)

For additional edge protection, deploy a Cloudflare Worker:

```bash
cd workers
npx wrangler deploy
```

The Worker (`workers/ddos-protection/src/index.ts`) provides:
- Geographic blocking (block traffic from non-Nigerian regions during election)
- Advanced bot detection
- Rate limiting that persists across edge locations
- Challenge pages for suspicious patterns

### 9. Monitoring

Set up alerts in Cloudflare Dashboard:

1. Go to **Notifications** → Create
2. **DDoS Attack Detected** → Email + webhook
3. **HTTP Flood Detected** → Email
4. **SSL Certificate Expiration** → Email (30 days before)

Monitor in **Analytics → Security**:
- Total threats blocked
- Top attack vectors
- Geographic distribution of traffic

## DNS Record Reference

### Before Cloudflare (Direct Vercel)
```
Type    Name    Content
CNAME   @       cname.vercel-dns.com
CNAME   www     cname.vercel-dns.com
```

### After Cloudflare (Proxied)
```
Type    Name    Content                  Proxy
CNAME   @       cname.vercel-dns.com     🟠 Yes
CNAME   www     cname.vercel-dns.com     🟠 Yes
```

## Cost

| Feature | Cost |
|---------|------|
| DDoS Protection | Free (unlimited) |
| CDN | Free (unlimited bandwidth on Free plan) |
| SSL/TLS | Free |
| WAF Managed Rules | Free (5 rules) |
| Rate Limiting | Free (1 rule on Free plan) |
| Workers | Free (100K requests/day) |
| Page Rules | 3 on Free plan |

**Total: $0/month** — Cloudflare's free tier is sufficient for election-day protection.

## Verification

After setup, verify Cloudflare is active:

1. Visit `https://ngeop.ng` — should show HTTPS lock
2. Check for `cf-ray` header: `curl -I https://ngeop.ng`
3. Test DDoS protection: `curl -H "User-Agent: sqlmap/1.0" https://ngeop.ng/api/public/stats`
   - Should return 403 Forbidden (WAF blocking known attack tools)

## Troubleshooting

**Issue: Cloudflare 522 (Connection Timed Out)**
- Vercel domain not configured, or DNS not propagated
- Solution: Wait 24h, verify DNS at dnschecker.org

**Issue: Cloudflare 523 (Origin Unreachable)**
- Vercel deployment is down
- Solution: Check Vercel dashboard for deployment status

**Issue: Cloudflare 1020 (Access Denied)**
- Custom WAF rule blocking legitimate traffic
- Solution: Temporarily disable the rule, refine it

**Issue: Slow TTFB (Time to First Byte)**
- Cloudflare is caching stale data, or origin is slow
- Solution: Purge cache in Cloudflare Dashboard → Caching → Purge Everything

## Quick Start (5 minutes)

1. Register domain → add to Cloudflare (Free plan)
2. Set DNS: CNAME `@` → `cname.vercel-dns.com` (Proxied 🟠)
3. Update nameservers at registrar
4. Add domain to Vercel project
5. Enable SSL Full Strict in Cloudflare
6. Done — your site is now behind Cloudflare's global DDoS protection
