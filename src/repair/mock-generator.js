/**
 * Offline Mock Generator Module
 * Membuat mock endpoints dan substitute untuk mode offline
 * - Generate mock API responses
 * - Create fallback data structures
 * - Handle network failures gracefully
 * - Implement state persistence
 */

export class OfflineMockGenerator {
  constructor(zipFS, manifest, analysisData = {}) {
    this.zipFS = zipFS;
    this.manifest = manifest;
    this.analysisData = analysisData;
    this.mocks = {};
    this.fallbacks = {};
    this.stateStore = new Map();
  }

  /**
   * Generate mocks lengkap untuk offline
   */
  async generateAllMocks() {
    console.log('[OfflineMockGenerator] Generating offline mocks...');
    
    const mocks = await Promise.all([
      this.generateAPIMocks(),
      this.generateDataMocks(),
      this.generateNetworkFallbacks(),
      this.generateStateManager(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      api_mocks: mocks[0],
      data_mocks: mocks[1],
      network_fallbacks: mocks[2],
      state_manager: mocks[3],
      summary: this.generateMockSummary()
    };
  }

  /**
   * Generate API mocks
   */
  async generateAPIMocks() {
    console.log('[OfflineMockGenerator] Creating API mocks...');
    
    const mocks = {};
    const jsFiles = this.manifest.assets?.filter(a => 
      a.path?.endsWith('.js') || a.path?.endsWith('.mjs')
    ) || [];

    // Detect API endpoints
    for (const file of jsFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        
        // Find fetch/axios calls
        const apiRegex = /(?:fetch|axios\.(?:get|post|put|delete))\s*\(\s*['"]([^'"]+)['"]/g;
        let match;
        const endpoints = new Set();
        
        while ((match = apiRegex.exec(content)) !== null) {
          endpoints.add(match[1]);
        }

        endpoints.forEach(endpoint => {
          if (!mocks[endpoint]) {
            mocks[endpoint] = {
              endpoint: endpoint,
              method: this.detectHTTPMethod(endpoint, content),
              mock_responses: this.generateMockResponse(endpoint),
              fallback_cache_key: `cache_${this.hashString(endpoint)}`,
              timeout: 5000,
              retry_attempts: 3
            };
          }
        });
      } catch (err) {
        // Skip
      }
    }

    return mocks;
  }

  /**
   * Generate data mocks untuk game state
   */
  async generateDataMocks() {
    console.log('[OfflineMockGenerator] Creating data mocks...');
    
    const mocks = {};
    const jsonFiles = this.manifest.assets?.filter(a => a.path?.endsWith('.json')) || [];

    for (const file of jsonFiles) {
      try {
        const content = await this.zipFS.readFile(file.path, 'utf-8');
        const data = JSON.parse(content);

        // Identify common game data structures
        const fileName = file.path.split('/').pop().toLowerCase();
        
        if (fileName.includes('paytable') || fileName.includes('symbol')) {
          mocks['paytable'] = {
            file: file.path,
            sample: this.getSampleData(data, 5),
            structure: this.analyzeDataStructure(data)
          };
        }
        
        if (fileName.includes('config') || fileName.includes('setting')) {
          mocks['config'] = {
            file: file.path,
            sample: this.getSampleData(data, 10),
            structure: this.analyzeDataStructure(data)
          };
        }

        if (fileName.includes('feature') || fileName.includes('bonus')) {
          mocks['features'] = {
            file: file.path,
            sample: this.getSampleData(data, 5),
            structure: this.analyzeDataStructure(data)
          };
        }
      } catch (err) {
        // Skip invalid JSON
      }
    }

    return mocks;
  }

  /**
   * Generate network fallbacks
   */
  async generateNetworkFallbacks() {
    console.log('[OfflineMockGenerator] Creating network fallbacks...');
    
    return {
      strategy: 'cache-first-with-network-fallback',
      cache_storage: 'offline-game-cache-v1',
      ttl_seconds: 86400, // 24 hours
      fallback_data: {
        player: {
          id: 'offline_player_' + Date.now(),
          balance: 1000,
          currency: 'USD',
          username: 'Player'
        },
        session: {
          id: 'offline_session_' + this.generateRandomId(),
          start_time: new Date().toISOString(),
          status: 'offline'
        },
        game_state: {
          reel_positions: [0, 0, 0, 0, 0],
          spin_count: 0,
          last_spin_result: null,
          total_win: 0
        }
      },
      network_error_handlers: {
        'timeout': {
          action: 'return_cached_data',
          fallback: 'return_fallback_data'
        },
        '0_network_error': {
          action: 'return_cached_data',
          fallback: 'return_fallback_data'
        },
        '404_not_found': {
          action: 'return_mock_data',
          fallback: 'return_404_response'
        }
      }
    };
  }

  /**
   * Generate state manager untuk offline
   */
  async generateStateManager() {
    console.log('[OfflineMockGenerator] Creating state manager...');
    
    return {
      implementation: `
class OfflineStateManager {
  constructor() {
    this.state = {};
    this.localStorage = typeof window !== 'undefined' ? window.localStorage : new Map();
    this.syncQueue = [];
  }

  setState(key, value) {
    this.state[key] = value;
    this.persistToStorage(key, value);
    this.syncQueue.push({ key, value, timestamp: Date.now() });
  }

  getState(key) {
    if (this.state[key]) return this.state[key];
    return this.loadFromStorage(key);
  }

  persistToStorage(key, value) {
    try {
      if (this.localStorage.setItem) {
        this.localStorage.setItem(\`offline_state_\${key}\`, JSON.stringify(value));
      }
    } catch (e) {
      console.warn('Storage quota exceeded:', e);
    }
  }

  loadFromStorage(key) {
    try {
      if (this.localStorage.getItem) {
        const item = this.localStorage.getItem(\`offline_state_\${key}\`);
        return item ? JSON.parse(item) : null;
      }
    } catch (e) {
      console.warn('Failed to load state:', e);
    }
    return null;
  }

  getSyncQueue() {
    return this.syncQueue;
  }

  clearSyncQueue() {
    this.syncQueue = [];
  }
}

// Export instance
export const stateManager = new OfflineStateManager();
      `,
      storage_keys: [
        'player_balance',
        'spin_history',
        'game_state',
        'session_data',
        'offline_mode_flag'
      ]
    };
  }

  /**
   * Detect HTTP method from code context
   */
  detectHTTPMethod(endpoint, content) {
    if (content.includes(`axios.post('${endpoint}`) || content.includes(`fetch('${endpoint}', {method: 'POST'`)) {
      return 'POST';
    }
    if (content.includes(`axios.put('${endpoint}`) || content.includes(`fetch('${endpoint}', {method: 'PUT'`)) {
      return 'PUT';
    }
    if (content.includes(`axios.delete('${endpoint}`) || content.includes(`fetch('${endpoint}', {method: 'DELETE'`)) {
      return 'DELETE';
    }
    return 'GET';
  }

  /**
   * Generate mock response berdasarkan endpoint
   */
  generateMockResponse(endpoint) {
    const lower = endpoint.toLowerCase();
    
    if (lower.includes('spin') || lower.includes('play')) {
      return {
        success: true,
        result: {
          reels: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [1, 2, 3], [4, 5, 6]],
          win: 0,
          multiplier: 1,
          feature: null
        }
      };
    }
    
    if (lower.includes('balance') || lower.includes('player')) {
      return {
        success: true,
        player: {
          balance: 1000,
          currency: 'USD',
          level: 1
        }
      };
    }

    if (lower.includes('config') || lower.includes('settings')) {
      return {
        success: true,
        config: {
          rtp: 96.5,
          volatility: 'medium',
          min_bet: 0.1,
          max_bet: 100
        }
      };
    }

    // Generic fallback
    return {
      success: true,
      data: {},
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Helper: Analyze data structure
   */
  analyzeDataStructure(data, maxDepth = 2, depth = 0) {
    if (depth >= maxDepth) return typeof data;
    
    if (Array.isArray(data)) {
      return {
        type: 'array',
        length: data.length,
        items: data.length > 0 ? this.analyzeDataStructure(data[0], maxDepth, depth + 1) : 'unknown'
      };
    }
    
    if (typeof data === 'object' && data !== null) {
      return {
        type: 'object',
        keys: Object.keys(data).length,
        sample_keys: Object.keys(data).slice(0, 3)
      };
    }
    
    return typeof data;
  }

  /**
   * Helper: Get sample data
   */
  getSampleData(data, limit = 5) {
    if (Array.isArray(data)) {
      return data.slice(0, limit);
    }
    return data;
  }

  /**
   * Helper: Hash string
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Helper: Generate random ID
   */
  generateRandomId() {
    return Math.random().toString(36).substr(2, 9);
  }

  /**
   * Generate mock summary
   */
  generateMockSummary() {
    return {
      total_api_endpoints: Object.keys(this.mocks.api_mocks || {}).length,
      data_structures: Object.keys(this.mocks.data_mocks || {}).length,
      fallback_strategies: Object.keys(this.mocks.network_fallbacks || {}).length,
      ready_for_offline: true,
      next_steps: [
        'Test all endpoints with mocks',
        'Verify fallback data accuracy',
        'Test network failure scenarios',
        'Validate state persistence'
      ]
    };
  }
}

export default OfflineMockGenerator;
