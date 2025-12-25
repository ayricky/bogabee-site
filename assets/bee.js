(function() {
    const BEE_SVG = `<svg viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
    <linearGradient id="abdomen" x1="24" y1="26" x2="24" y2="50" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fcd34d"/>
        <stop offset="1" stop-color="#ea580c"/>
    </linearGradient>
    <radialGradient id="thorax" cx="24" cy="19" r="9" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#c9a227"/>
        <stop offset="0.7" stop-color="#6b4423"/>
        <stop offset="1" stop-color="#3d2914"/>
    </radialGradient>
</defs>
<!-- Wings attached at thorax - larger -->
<path class="wing-l" d="M17 17 Q4 10 2 4 Q0 -2 8 2 Q16 6 20 15 Z" fill="rgba(255,255,255,0.8)" stroke="#d4a012" stroke-width="0.5"/>
<path class="wing-r" d="M31 17 Q44 10 46 4 Q48 -2 40 2 Q32 6 28 15 Z" fill="rgba(255,255,255,0.8)" stroke="#d4a012" stroke-width="0.5"/>
<!-- Abdomen -->
<ellipse cx="24" cy="36" rx="11" ry="12" fill="url(#abdomen)"/>
<!-- Bold stripes -->
<path d="M13.5 30 Q24 33 34.5 30" stroke="#1c1917" stroke-width="4" stroke-linecap="round"/>
<path d="M14 38 Q24 41 34 38" stroke="#1c1917" stroke-width="3.5" stroke-linecap="round"/>
<path d="M17 44 Q24 46 31 44" stroke="#1c1917" stroke-width="2.5" stroke-linecap="round"/>
<!-- Fuzzy thorax -->
<ellipse cx="24" cy="20" rx="9" ry="7.5" fill="url(#thorax)"/>
<circle cx="19" cy="17" r="1.5" fill="#a08060" opacity="0.5"/>
<circle cx="29" cy="17" r="1.5" fill="#a08060" opacity="0.5"/>
<circle cx="24" cy="22" r="1.3" fill="#a08060" opacity="0.5"/>
<circle cx="21" cy="20" r="1.1" fill="#a08060" opacity="0.4"/>
<circle cx="27" cy="20" r="1.1" fill="#a08060" opacity="0.4"/>
<circle cx="24" cy="18" r="1" fill="#a08060" opacity="0.35"/>
<!-- Head -->
<circle cx="24" cy="9" r="5.5" fill="#1c1917"/>
<!-- Compound eyes -->
<ellipse cx="19" cy="8" rx="2.2" ry="2.8" fill="#0f0d0a"/>
<ellipse cx="29" cy="8" rx="2.2" ry="2.8" fill="#0f0d0a"/>
<!-- Antennae -->
<path d="M20 3.5 Q17 1 13 2" stroke="#1c1917" stroke-width="1.3" stroke-linecap="round" fill="none"/>
<path d="M28 3.5 Q31 1 35 2" stroke="#1c1917" stroke-width="1.3" stroke-linecap="round" fill="none"/>
<!-- Stinger -->
<path d="M24 48 L24 53" stroke="#1c1917" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

    function initBee() {
        const bee = document.createElement('div');
        bee.className = 'bee';
        bee.innerHTML = BEE_SVG;
        document.body.appendChild(bee);
        
        let mouseX = window.innerWidth >> 1;
        let mouseY = window.innerHeight >> 1;
        let beeX = mouseX;
        let beeY = mouseY;
        let prevBeeX = beeX;
        let prevBeeY = beeY;
        let angle = 0;
        
        // Inactivity & Fly Away Logic
        let lastMouseMoveTime = Date.now();
        let isFlyingAway = false;
        let isOffScreen = false;
        let flyAwayTargetX = 0;
        let flyAwayTargetY = 0;
        
        // Crossover Logic
        let isCrossing = false;
        let crossTargetX = 0;
        let crossTargetY = 0;
        let crossEndTime = 0;
        let nextCrossCheck = Date.now() + 4000;
        
        // Random sway parameters
        const s1 = Math.random() * 100;
        const s2 = Math.random() * 100;
        const s3 = Math.random() * 100;

        document.addEventListener('mousemove', function(e) {
            mouseX = e.clientX;
            mouseY = e.clientY;
            lastMouseMoveTime = Date.now();
            if (isFlyingAway || isOffScreen) {
                isFlyingAway = false;
                isOffScreen = false;
                // Bee returns from a random edge
                const edge = Math.floor(Math.random() * 4);
                if (edge === 0) { beeX = -50; beeY = Math.random() * window.innerHeight; }
                else if (edge === 1) { beeX = window.innerWidth + 50; beeY = Math.random() * window.innerHeight; }
                else if (edge === 2) { beeX = Math.random() * window.innerWidth; beeY = -50; }
                else { beeX = Math.random() * window.innerWidth; beeY = window.innerHeight + 50; }
            }
        }, { passive: true });

        function animate(now) {
            const t = now * 0.001;
            
            // 1. Check for Inactivity (6 seconds)
            if (!isFlyingAway && !isOffScreen && Date.now() - lastMouseMoveTime > 6000) {
                isFlyingAway = true;
                // Pick a random direction to fly off
                const flyAngle = Math.random() * Math.PI * 2;
                const dist = Math.max(window.innerWidth, window.innerHeight) + 100;
                flyAwayTargetX = beeX + Math.cos(flyAngle) * dist;
                flyAwayTargetY = beeY + Math.sin(flyAngle) * dist;
            }
            
            // Check if bee has left the screen
            if (isFlyingAway && (beeX < -60 || beeX > window.innerWidth + 60 || beeY < -60 || beeY > window.innerHeight + 60)) {
                isOffScreen = true;
                isFlyingAway = false;
            }

            // 2. Determine Target
            let targetX, targetY, ease;

            if (isOffScreen) {
                // Bee is off screen, skip animation until mouse moves
                requestAnimationFrame(animate);
                return;
            } else if (isFlyingAway) {
                targetX = flyAwayTargetX;
                targetY = flyAwayTargetY;
                ease = 0.008;
            } else if (!isCrossing && now > nextCrossCheck && Math.random() < 0.25) {
                // Start Crossover
                isCrossing = true;
                crossTargetX = mouseX * 2 - beeX + (Math.random() - 0.5) * 100;
                crossTargetY = mouseY * 2 - beeY + (Math.random() - 0.5) * 100;
                crossEndTime = now + 600 + Math.random() * 500;
                nextCrossCheck = now + 4000 + Math.random() * 6000;
                targetX = crossTargetX;
                targetY = crossTargetY;
                ease = 0.055;
            } else if (isCrossing) {
                // Continue Crossover
                targetX = crossTargetX;
                targetY = crossTargetY;
                ease = 0.055;
                if (now > crossEndTime) isCrossing = false;
            } else {
                // Normal Follow
                const baseDist = 75;
                const distVar = 25;
                const dist = baseDist + Math.sin(t * 0.2) * distVar;
                
                const swayX = Math.sin(t * 0.6 + s1) * 0.7 +
                              Math.sin(t * 0.25 + s2) * 0.5;
                
                const swayY = Math.sin(t * 0.45 + s2) * 0.6 +
                              Math.cos(t * 0.15 + s3) * 0.4;
                
                targetX = mouseX + swayX * dist;
                targetY = mouseY + swayY * dist;
                ease = 0.035;
            }

            // 3. Move
            beeX += (targetX - beeX) * ease;
            beeY += (targetY - beeY) * ease;

            // 4. Rotate
            const dx = beeX - prevBeeX;
            const dy = beeY - prevBeeY;
            const distToMouse = Math.sqrt((beeX - mouseX)**2 + (beeY - mouseY)**2);
            
            let targetAngle = angle;

            // Prioritize facing the cursor when hovering nearby (looks more attentive)
            // But face movement direction when flying fast or far
            if (isFlyingAway || isCrossing || distToMouse > 120) {
                // Face Flight Path
                if (dx*dx + dy*dy > 0.5) {
                    targetAngle = Math.atan2(dy, dx) * 57.29 + 90;
                }
            } else {
                // Face Cursor (Hover Mode)
                targetAngle = Math.atan2(mouseY - beeY, mouseX - beeX) * 57.29 + 90;
            }

            prevBeeX = beeX;
            prevBeeY = beeY;
            
            // Smooth Rotation
            let angleDiff = targetAngle - angle;
            while (angleDiff > 180) angleDiff -= 360;
            while (angleDiff < -180) angleDiff += 360;
            angle += angleDiff * 0.08;

            const wobbleX = Math.sin(t * 11) * 1.5;
            const wobbleY = Math.cos(t * 13) * 1.5;
            bee.style.transform = `translate3d(${beeX + wobbleX}px,${beeY + wobbleY}px,0) rotate(${angle}deg)`;

            requestAnimationFrame(animate);
        }

        requestAnimationFrame(animate);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBee);
    } else {
        initBee();
    }
})();
