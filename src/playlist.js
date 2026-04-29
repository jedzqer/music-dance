export class Playlist {
  constructor() {
    this.items = [];
    this.currentIndex = -1;
    this.folderPath = null;
  }

  async loadFromFolder(folderPath) {
    if (!window.electronAPI) {
      throw new Error('需要在Electron环境中运行');
    }

    try {
      this.items = await window.electronAPI.scanFolder(folderPath);
      this.folderPath = folderPath;
      this.currentIndex = -1;
      return this.items;
    } catch (error) {
      console.error('加载文件夹失败:', error);
      throw error;
    }
  }

  addFiles(files) {
    for (const file of files) {
      const exists = this.items.some(item => item.path === file.path);
      if (!exists) {
        this.items.push(file);
      }
    }
    return this.items;
  }

  removeItem(index) {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      if (this.currentIndex >= this.items.length) {
        this.currentIndex = this.items.length - 1;
      }
    }
  }

  clear() {
    this.items = [];
    this.currentIndex = -1;
    this.folderPath = null;
  }

  setCurrentIndex(index) {
    if (index >= 0 && index < this.items.length) {
      this.currentIndex = index;
      return this.items[index];
    }
    return null;
  }

  getCurrentItem() {
    if (this.currentIndex >= 0 && this.currentIndex < this.items.length) {
      return this.items[this.currentIndex];
    }
    return null;
  }

  getNext() {
    if (this.items.length === 0) return null;
    
    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.items.length) {
      nextIndex = 0;
    }
    
    this.currentIndex = nextIndex;
    return this.items[this.currentIndex];
  }

  getPrevious() {
    if (this.items.length === 0) return null;
    
    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.items.length - 1;
    }
    
    this.currentIndex = prevIndex;
    return this.items[this.currentIndex];
  }

  shuffle() {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
    this.currentIndex = -1;
  }

  getItemByPath(filePath) {
    return this.items.find(item => item.path === filePath);
  }

  getIndexByPath(filePath) {
    return this.items.findIndex(item => item.path === filePath);
  }

  getSize() {
    return this.items.length;
  }

  isEmpty() {
    return this.items.length === 0;
  }
}