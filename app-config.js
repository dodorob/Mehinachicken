'use strict';

const fs   = require('fs');
const path = require('path');

class AppConfig {
  constructor(configDir) {
    this._configPath = path.join(configDir, 'buchpro-config.json');
    this._data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this._configPath)) {
        return JSON.parse(fs.readFileSync(this._configPath, 'utf8'));
      }
    } catch (_) {}
    return {};
  }

  _save() {
    try {
      fs.writeFileSync(this._configPath, JSON.stringify(this._data, null, 2), 'utf8');
    } catch (e) {
      console.error('AppConfig: failed to save:', e.message);
    }
  }

  get(key) {
    return this._data[key] !== undefined ? this._data[key] : null;
  }

  set(key, value) {
    this._data[key] = value;
    this._save();
  }

  delete(key) {
    delete this._data[key];
    this._save();
  }
}

module.exports = AppConfig;
