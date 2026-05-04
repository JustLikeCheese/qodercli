#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Configuration
const BINARY_NAME = 'qodercli';
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(PACKAGE_ROOT, 'bin');
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json');

class QoderInstaller {
  constructor() {
    this.platform = this.detectPlatform();
    this.arch = this.detectArch();
    this.binPath = path.join(BIN_DIR, BINARY_NAME + (process.platform === 'win32' ? '.exe' : ''));
    this.packageInfo = this.loadPackageInfo();
  }

  detectPlatform() {
    switch (process.platform) {
      case 'darwin': return 'darwin';
      case 'linux': return 'linux';
      case 'win32': return 'windows';
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  detectArch() {
    const arch = process.arch;
    switch (arch) {
      case 'x64': return 'amd64';
      case 'arm64': return 'arm64';
      default:
        throw new Error(`Unsupported architecture: ${arch}`);
    }
  }

  loadPackageInfo() {
    try {
      const packageJson = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
      const packageInfo = JSON.parse(packageJson);
      
      if (!packageInfo.binaries || !packageInfo.binaries.files) {
        throw new Error('Binary information missing in package configuration');
      }
      
      return packageInfo;
    } catch (error) {
      throw new Error(`Unable to read package configuration: ${error.message}`);
    }
  }

  findBinaryInfo() {
    const files = this.packageInfo.binaries.files;
    const targetFile = files.find(file => 
      file.os === this.platform && file.arch === this.arch
    );

    if (!targetFile) {
      throw new Error(`Unsupported platform: ${this.platform}/${this.arch}`);
    }

    return targetFile;
  }

  async downloadBinary(url, expectedSha256) {
    console.log(`Downloading binary: ${url}`);
    
    // Ensure directory exists
    if (!fs.existsSync(BIN_DIR)) {
      fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    // Download file
    const filename = path.basename(url);
    const archivePath = path.join(BIN_DIR, filename);
    
    try {
      await this.downloadFile(url, archivePath);
      
      // Verify checksum
      console.log('Verifying file integrity...');
      const actualSha256 = this.calculateSha256(archivePath);
      if (actualSha256 !== expectedSha256) {
        throw new Error(`Checksum mismatch. Expected: ${expectedSha256}, Got: ${actualSha256}`);
      }
      
      // Extract file
      console.log('Extracting binary...');
      await this.extractArchive(archivePath, filename);
      
      // Remove archive
      fs.unlinkSync(archivePath);
      
      // Set executable permission
      if (process.platform !== 'win32') {
        fs.chmodSync(this.binPath, 0o755);
      }
      
      // Create installation source marker
      const sourceFile = path.join(BIN_DIR, '.qodercli-install-resource');
      fs.writeFileSync(sourceFile, 'npm', 'utf8');
      
      // Verify installation
      this.verifyInstallation();
      
    } catch (error) {
      // Cleanup failed download
      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath);
      }
      throw error;
    }
  }

  async extractArchive(archivePath, filename) {
    if (filename.endsWith('.zip')) {
      // Extract ZIP file
      if (process.platform === 'win32') {
        // Windows: Use PowerShell
        try {
          execSync(`powershell -command "Expand-Archive -Path '${archivePath}' -DestinationPath '${BIN_DIR}' -Force"`, {
            stdio: 'pipe'
          });
          
          // Additional verification - check if binary file exists after extraction
          if (!fs.existsSync(this.binPath)) {
            // Maybe the binary is in a subdirectory, let's check
            const extractedFiles = this.findExtractedBinary(BIN_DIR);
            if (extractedFiles.length > 0) {
              fs.renameSync(extractedFiles[0], this.binPath);
            } else {
              throw new Error(`Binary file not found after extraction. Expected at: ${this.binPath}`);
            }
          }
        } catch (error) {
          throw new Error(`ZIP extraction failed: ${error.message}. Please ensure PowerShell is available.`);
        }
      } else {
        // Unix: Use unzip command
        try {
          execSync(`unzip -o "${archivePath}" -d "${BIN_DIR}"`, {
            stdio: 'pipe'
          });
        } catch (error) {
          throw new Error('ZIP extraction failed. Please ensure unzip command is installed.');
        }
      }
    } else {
      // Extract tar.gz file
      try {
        execSync(`tar -xzf "${archivePath}" -C "${BIN_DIR}"`, {
          stdio: 'pipe'
        });
      } catch (error) {
        throw new Error('tar.gz extraction failed. Please ensure tar command is installed.');
      }
    }
  }

  calculateSha256(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  }

  findExtractedBinary(searchDir) {
    const results = [];
    const expectedFilename = BINARY_NAME + (process.platform === 'win32' ? '.exe' : '');
    
    try {
      const items = fs.readdirSync(searchDir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(searchDir, item.name);
        
        if (item.isDirectory()) {
          // Recursively search in subdirectories
          results.push(...this.findExtractedBinary(fullPath));
        } else if (item.name === expectedFilename) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Unable to search directory ${searchDir}:`, error.message);
    }
    
    return results;
  }

  verifyInstallation() {
    if (!fs.existsSync(this.binPath)) {
      throw new Error('Binary installation failed');
    }

    try {
      // Try to run version command for verification
      const output = execSync(`"${this.binPath}" --version`, {
        encoding: 'utf8',
        stdio: 'pipe'
      });
      console.log('Installation verified successfully');
      console.log(`Version info: ${output.trim()}`);
    } catch (error) {
      console.warn('Warning: Unable to verify installation, but binary file exists');
    }
  }

  async downloadFile(url, filePath, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      const client = url.startsWith('https:') ? https : http;
      
      const request = client.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          file.close();
          fs.unlinkSync(filePath);
          return this.downloadFile(response.headers.location, filePath, timeout)
            .then(resolve).catch(reject);
        }
        
        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
        
        file.on('error', (error) => {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          reject(error);
        });
      }).on('error', (error) => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        reject(error);
      });

      // Set timeout
      request.setTimeout(timeout, () => {
        request.destroy();
        file.close();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        reject(new Error(`Download timeout (${timeout}ms): ${url}`));
      });
    });
  }

  async install() {
    try {
      console.log('Installing Qoder CLI...');
      console.log(`Target platform: ${this.platform}/${this.arch}`);
      console.log(`Version: ${this.packageInfo.binaries.version}`);
      
      // If already installed, reinstall
      if (fs.existsSync(this.binPath)) {
        console.log('Existing version detected, will reinstall');
      }

      const binaryInfo = this.findBinaryInfo();
      await this.downloadBinary(binaryInfo.url, binaryInfo.sha256);
      
      console.log('✅ Qoder CLI installed successfully!');
      console.log(`Run 'npx qodercli --help' to get started`);
      
    } catch (error) {
      console.error('❌ Installation failed:', error.message);
      process.exit(1);
    }
  }
}

// Main program
if (require.main === module) {
  const installer = new QoderInstaller();
  installer.install();
}

module.exports = QoderInstaller;