/**
 * Security Scanner Module
 * Scan untuk celah keamanan dalam game yang dikumpulkan
 * - Hardcoded credentials & API keys
 * - XSS vulnerabilities
 * - Insecure API calls
 * - Protected resources & DRM markers
 * - Data exposure risks
 */

export class SecurityScanner {
  constructor(zipFS, manifest) {
    this.zipFS = zipFS;
    this.manifest = manifest;
    this.vulnerabilities = [];
    this.risksFound = [];
  }

  /**
   * Jalankan scan keamanan lengkap
   */
  async scanAll() {
    console.log('[SecurityScanner] Starting comprehensive security scan...');
    
    await Promise.all([
      this.scanForCredentials(),
      this.scanForXSS(),
      this.scanForInsecureAPI(),
      this.scanForProtectedResources(),
      this.scanForDataExposure(),
      this.scanForSuspiciousPatterns(),
    ]);

    return this.generateSecurityReport();
  }

  /**
   * Deteksi hardcoded credentials
   */
  async scanForCredentials() {
    console.log('[SecurityScanner] Scanning for hardcoded credentials...');
    
    const allFiles = this.manifest.assets || [];
    const credentialPatterns = {
      API_KEY: /['"](api[_-]?key|apikey|api_token)['"]\s*[:=]\s*['"]([^'"]{8,})['"],?/gi,
      SECRET_KEY: /['"](secret|password|pwd|pass)['"]\s*[:=]\s*['"]([^'"]{8,})['"],?/gi,
      AUTH_TOKEN: /['"](token|auth|bearer|x-api-key)['"]\s*[:=]\s*['"]([^'"]{20,})['"],?/gi,
      DB_CONNECTION: /['"](db_url|database|connection|mongodb|mysql)['"]\s*[:=]\s*['"]([^'"]+:\/\/[^'"]+)['"],?/gi,
      AWS_KEY: /AKIA[0-9A-Z]{16}/g,
      PRIVATE_KEY: /-----BEGIN (PRIVATE|RSA) KEY-----[\s\S]*?-----END (PRIVATE|RSA) KEY-----/g,
      JWT_TOKEN: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    };

    for (const file of allFiles) {
      if (!file.path) continue;
      
      // Skip binary files
      if (this.isBinaryFile(file.path)) continue;

      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Scan each credential pattern
        Object.entries(credentialPatterns).forEach(([type, regex]) => {
          let match;
          const regexG = new RegExp(regex.source, 'g' + (regex.flags || ''));
          
          while ((match = regexG.exec(content)) !== null) {
            this.vulnerabilities.push({
              type: 'HARDCODED_CREDENTIAL',
              severity: 'CRITICAL',
              category: type,
              file: file.path,
              line: this.getLineNumber(content, match.index),
              value_preview: match[0].substring(0, 50) + '...',
              message: `Hardcoded ${type} detected`,
              risk: 'Credential exposure - attacker can impersonate or access backend',
              fix: 'Move to environment variables or secure configuration'
            });
          }
        });
      } catch (err) {
        // Skip read errors
      }
    }
  }

  /**
   * Deteksi XSS vulnerabilities
   */
  async scanForXSS() {
    console.log('[SecurityScanner] Analyzing for XSS vulnerabilities...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    const xssPatterns = {
      innerHTML: /\.innerHTML\s*=\s*(?!['"][^'"]*['"])/,
      insertAdjacentHTML: /insertAdjacentHTML\s*\(/,
      document_write: /document\.write\s*\(/,
      eval: /\beval\s*\(/,
      Function_constructor: /new\s+Function\s*\(/,
      dangerouslySetInnerHTML: /dangerouslySetInnerHTML/,
    };

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        Object.entries(xssPatterns).forEach(([type, regex]) => {
          if (regex.test(content)) {
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              if (regex.test(line)) {
                this.vulnerabilities.push({
                  type: 'XSS_VULNERABILITY',
                  severity: 'HIGH',
                  category: type,
                  file: file.path,
                  line: idx + 1,
                  code_snippet: line.trim().substring(0, 80),
                  message: `Potential XSS via ${type}`,
                  risk: 'Unsanitized user input can execute malicious scripts',
                  fix: `Use textContent instead of ${type} or sanitize input with DOMPurify`
                });
              }
            });
          }
        });
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Deteksi insecure API calls
   */
  async scanForInsecureAPI() {
    console.log('[SecurityScanner] Checking for insecure API patterns...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Check for HTTP instead of HTTPS
        const httpRegex = /https?:\/\/(?!localhost|127\.0\.0\.1)[^\s'"]+/g;
        const matches = content.match(httpRegex) || [];
        
        matches.forEach((match, idx) => {
          if (match.startsWith('http://') && !match.includes('localhost')) {
            this.vulnerabilities.push({
              type: 'INSECURE_API_CALL',
              severity: 'HIGH',
              category: 'UNENCRYPTED_TRANSPORT',
              file: file.path,
              url: match,
              message: `Unencrypted HTTP API call: ${match}`,
              risk: 'Data transmitted in plaintext - vulnerable to interception',
              fix: 'Use HTTPS for all API calls'
            });
          }
        });

        // Check for fetch without error handling
        const fetchRegex = /fetch\s*\(\s*['"]([^'"]+)['"]\s*\)(?!\.then|\s*\.catch)/g;
        let fetchMatch;
        while ((fetchMatch = fetchRegex.exec(content)) !== null) {
          this.risksFound.push({
            type: 'UNHANDLED_FETCH',
            severity: 'MEDIUM',
            file: file.path,
            line: this.getLineNumber(content, fetchMatch.index),
            url: fetchMatch[1],
            message: 'Fetch call without error handling',
            risk: 'Network errors not caught - may cause silent failures offline',
            fix: 'Add .catch() handler for all fetch calls'
          });
        }

        // Check for exposed request details
        const headerRegex = /headers\s*:\s*{[\s\S]*?Authorization[\s\S]*?}/;
        if (headerRegex.test(content)) {
          this.vulnerabilities.push({
            type: 'EXPOSED_AUTH_HEADER',
            severity: 'HIGH',
            file: file.path,
            message: 'Authorization header sent in request',
            risk: 'Sensitive auth data may be logged or exposed',
            fix: 'Use secure HTTP-only cookies or environment variables'
          });
        }
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Deteksi protected resources & DRM markers
   */
  async scanForProtectedResources() {
    console.log('[SecurityScanner] Scanning for protected resources...');
    
    const allFiles = this.manifest.assets || [];
    
    const protectionMarkers = {
      DRM: /drm|anti[_-]?cheat|license|activation|unlock|key[_-]?check|validate[_-]?key/i,
      ENCRYPTION: /encrypt|decrypt|cipher|aes|rsa|sha256|crypto/i,
      PROTECTION: /protect|obfuscate|minify|nonce|signature|verify/i,
      TOKEN_CHECK: /token|auth|bearer|x-api-key|x-auth|authorization/i,
    };

    for (const file of allFiles) {
      if (!file.path || this.isBinaryFile(file.path)) continue;

      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        Object.entries(protectionMarkers).forEach(([type, regex]) => {
          if (regex.test(content)) {
            this.risksFound.push({
              type: 'PROTECTED_RESOURCE_MARKER',
              severity: 'MEDIUM',
              category: type,
              file: file.path,
              message: `${type} protection mechanism detected`,
              note: 'Offline mode requires mocking or bypass',
              fix: `Create mock for ${type} endpoints or implement offline substitute`
            });
          }
        });
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Deteksi data exposure risks
   */
  async scanForDataExposure() {
    console.log('[SecurityScanner] Analyzing data exposure risks...');
    
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Check for localStorage/sessionStorage usage
        if (content.includes('localStorage') || content.includes('sessionStorage')) {
          this.risksFound.push({
            type: 'DATA_STORAGE',
            severity: 'MEDIUM',
            file: file.path,
            message: 'LocalStorage/SessionStorage usage detected',
            risk: 'Sensitive data stored unencrypted in browser',
            fix: 'Encrypt sensitive data before storing locally'
          });
        }

        // Check for console.log with sensitive data
        const consoleLogRegex = /console\.log\s*\(\s*([^)]{20,})\s*\)/g;
        const logMatches = content.match(consoleLogRegex) || [];
        
        if (logMatches.length > 0) {
          this.risksFound.push({
            type: 'DEBUG_LOGGING',
            severity: 'LOW',
            file: file.path,
            count: logMatches.length,
            message: `Found ${logMatches.length} console.log statements`,
            risk: 'Debug output may expose sensitive information in production',
            fix: 'Remove console.log statements in production builds'
          });
        }

        // Check for global variables
        const globalVarRegex = /window\.\w+\s*=\s*[^;]+;/g;
        const globalMatches = content.match(globalVarRegex) || [];
        
        if (globalMatches.length > 5) {
          this.risksFound.push({
            type: 'GLOBAL_EXPOSURE',
            severity: 'MEDIUM',
            file: file.path,
            count: globalMatches.length,
            message: `Found ${globalMatches.length} window object assignments`,
            risk: 'Global variables accessible by any script on page',
            fix: 'Use module scope instead of global window object'
          });
        }
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Deteksi suspicious patterns
   */
  async scanForSuspiciousPatterns() {
    console.log('[SecurityScanner] Scanning for suspicious patterns...');
    
    const allFiles = this.manifest.assets || [];
    
    const suspiciousPatterns = {
      OBFUSCATION: /\\x[0-9a-f]{2}|String\.fromCharCode/,
      EVAL_USAGE: /eval\s*\(|Function\s*\(|setTimeout\s*\(\s*['"].*[=+]/,
      PROXY_PATTERN: /proxy|bypass|tunnel|forward/i,
      TRACKING: /gtag|analytics|track|telemetry|beacon/i,
      MALICIOUS_SCRIPT: /script.*src.*data:|javascript:/i,
    };

    for (const file of allFiles) {
      if (!file.path || this.isBinaryFile(file.path)) continue;

      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        Object.entries(suspiciousPatterns).forEach(([type, regex]) => {
          if (regex.test(content)) {
            this.vulnerabilities.push({
              type: 'SUSPICIOUS_PATTERN',
              severity: type === 'MALICIOUS_SCRIPT' ? 'CRITICAL' : 'MEDIUM',
              category: type,
              file: file.path,
              message: `Suspicious pattern detected: ${type}`,
              action: 'Review code for security implications'
            });
          }
        });
      } catch (err) {
        // Skip
      }
    }
  }

  /**
   * Helper: Check if file is binary
   */
  isBinaryFile(path) {
    const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mp3', '.wasm', '.so', '.dll'];
    return binaryExtensions.some(ext => path.toLowerCase().endsWith(ext));
  }

  /**
   * Helper: Get line number
   */
  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  /**
   * Generate security report
   */
  generateSecurityReport() {
    const report = {
      timestamp: new Date().toISOString(),
      security_score: this.calculateSecurityScore(),
      summary: {
        critical_vulnerabilities: this.vulnerabilities.filter(v => v.severity === 'CRITICAL').length,
        high_vulnerabilities: this.vulnerabilities.filter(v => v.severity === 'HIGH').length,
        medium_risks: this.risksFound.filter(r => r.severity === 'MEDIUM').length,
        low_risks: this.risksFound.filter(r => r.severity === 'LOW').length,
      },
      vulnerabilities: this.vulnerabilities.sort((a, b) => {
        const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (order[a.severity] || 999) - (order[b.severity] || 999);
      }),
      risks: this.risksFound.sort((a, b) => {
        const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (order[a.severity] || 999) - (order[b.severity] || 999);
      }),
      offline_readiness: this.assessOfflineReadiness(),
      recommendations: this.generateSecurityRecommendations()
    };

    return report;
  }

  /**
   * Calculate security score (0-100)
   */
  calculateSecurityScore() {
    const criticalCount = this.vulnerabilities.filter(v => v.severity === 'CRITICAL').length;
    const highCount = this.vulnerabilities.filter(v => v.severity === 'HIGH').length;
    const mediumCount = this.vulnerabilities.filter(v => v.severity === 'MEDIUM').length;

    let score = 100;
    score -= criticalCount * 15;
    score -= highCount * 8;
    score -= mediumCount * 3;

    return Math.max(0, score);
  }

  /**
   * Assess offline readiness
   */
  assessOfflineReadiness() {
    const protectedResources = this.risksFound.filter(r => r.type === 'PROTECTED_RESOURCE_MARKER').length;
    const unhandledFetches = this.risksFound.filter(r => r.type === 'UNHANDLED_FETCH').length;
    const criticalVulns = this.vulnerabilities.filter(v => v.severity === 'CRITICAL').length;

    return {
      protected_resources_found: protectedResources > 0,
      unhandled_network_calls: unhandledFetches > 0,
      security_blockers: criticalVulns > 0,
      recommendation: this.getOfflineRecommendation(protectedResources, unhandledFetches, criticalVulns)
    };
  }

  /**
   * Get offline mode recommendation
   */
  getOfflineRecommendation(protected, unhandled, critical) {
    if (critical > 0) {
      return '🔴 Cannot run offline - Critical security vulnerabilities must be fixed first';
    }
    if (protected > 0 && unhandled > 0) {
      return '🟡 Needs mocking - Multiple protected resources and unhandled network calls detected';
    }
    if (protected > 0) {
      return '🟡 Create mocks for protected resources before running offline';
    }
    if (unhandled > 0) {
      return '🟡 Add error handling for all network calls for better offline support';
    }
    return '🟢 Can run offline with proper asset collection and mocking';
  }

  /**
   * Generate security recommendations
   */
  generateSecurityRecommendations() {
    const recommendations = [];

    const criticalVulns = this.vulnerabilities.filter(v => v.severity === 'CRITICAL');
    if (criticalVulns.length > 0) {
      recommendations.push({
        priority: 1,
        title: '🔴 CRITICAL: Fix Hardcoded Credentials',
        action: `Remove ${criticalVulns.length} hardcoded credentials immediately`,
        timeline: 'Before any deployment'
      });
    }

    const xssVulns = this.vulnerabilities.filter(v => v.type === 'XSS_VULNERABILITY');
    if (xssVulns.length > 0) {
      recommendations.push({
        priority: 2,
        title: '⚠️ HIGH: XSS Protection Required',
        action: `Sanitize ${xssVulns.length} potential XSS vectors using DOMPurify or textContent`,
        timeline: 'Before offline deployment'
      });
    }

    const protectedRes = this.risksFound.filter(r => r.type === 'PROTECTED_RESOURCE_MARKER');
    if (protectedRes.length > 0) {
      recommendations.push({
        priority: 3,
        title: '🟡 MEDIUM: Create Mock Endpoints',
        action: `Mock ${protectedRes.length} protected resources for offline mode`,
        timeline: 'During offline preparation'
      });
    }

    return recommendations;
  }
}

export default SecurityScanner;
