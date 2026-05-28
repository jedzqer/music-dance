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

  setCurrentIndex(index) {
    if (index >= 0 && index < this.items.length) {
      this.currentIndex = index;
      return this.items[index];
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

  getSize() {
    return this.items.length;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  isAtEnd() {
    return this.currentIndex >= this.items.length - 1;
  }

  isAtBeginning() {
    return this.currentIndex <= 0;
  }

  getRandomIndex() {
    if (this.items.length <= 1) return this.currentIndex;
    let idx;
    do { idx = Math.floor(Math.random() * this.items.length); } while (idx === this.currentIndex);
    return idx;
  }
}