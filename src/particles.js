import { hslToRgb } from './utils.js';

export const MAX_PARTICLES = 250;

const particles = [];

class Particle {
    constructor(x, y, hue, speed) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * speed;
        this.vy = (Math.random() - 0.5) * speed;
        this.life = 1;
        this.decay = 0.006 + Math.random() * 0.025;
        this.size = 1 + Math.random() * 3;
        this.hue = hue;
    }

    update(intensity) {
        this.x += this.vx * (1 + intensity * 3);
        this.y += this.vy * (1 + intensity * 3);
        this.life -= this.decay;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        const alpha = this.life * 0.7;
        const [r, g, b] = hslToRgb(this.hue, 90, 55 + (1 - this.life) * 20);
        ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
        ctx.fill();
    }
}

export function spawnParticles(x, y, count, hue, speed) {
    for (let i = 0; i < count; i++) {
        if (particles.length >= MAX_PARTICLES) break;
        particles.push(new Particle(x, y, hue, speed));
    }
}

export function updateParticles(globalIntensity, ctx) {
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(globalIntensity);
        if (particles[i].life <= 0) {
            particles.splice(i, 1);
        } else {
            particles[i].draw(ctx);
        }
    }
    while (particles.length > MAX_PARTICLES) {
        particles.shift();
    }
}

export function resetParticles() {
    particles.length = 0;
}
