// Knowledge base for ChatVue. Every fact here is taken from the project's
// READMEs or read directly from the game source (file noted in `source`).
// Answers are trusted, author-written HTML; user input is never put in here.

const kbd = (k) => `<kbd>${k}</kbd>`;
const mph = (ms) => Math.round(ms * 2.237); // same conversion the HUD speedometer uses (hud.js)
const money = (n) => '$' + n.toLocaleString('en-US');

// ---------------------------------------------------------------- cheats (main.js)
const CHEATS = [
  ['HESOYAM', 'Restores health and armor to 100, adds <b>$250,000</b>, and fully repairs (and extinguishes) the vehicle you are in.', ['health', 'armor', 'money', 'cash', 'repair', 'heal']],
  ['TURTLE', 'Sets health and armor to 100.', ['health', 'armor', 'heal']],
  ['PAINKILLER', 'Toggles invincibility (god mode) on and off.', ['invincible', 'godmode', 'god', 'immortal']],
  ['TOOLUP', 'Gives every weapon (pistol, SMG, shotgun, RPG, minigun) and equips the RPG.', ['weapon', 'gun', 'ammo', 'all']],
  ['FULLCLIP', 'Toggles infinite ammo.', ['ammo', 'infinite', 'bullet']],
  ['LAWYERUP', 'Clears your wanted level to zero stars.', ['wanted', 'police', 'clear', 'star']],
  ['FUGITIVE', 'Raises your wanted level by one star.', ['wanted', 'police', 'raise', 'star']],
  ['LEAVEMEALONE', 'Toggles "never wanted": clears your stars and stops new ones while on.', ['wanted', 'police', 'never', 'star']],
  ['SKYFALL', 'Throws you out of any vehicle and drops you from 800 m. Press <kbd>Space</kbd> to open the parachute.', ['parachute', 'skydive', 'sky', 'fall']],
  ['COMET', 'Spawns a Comet X sports car next to you.', ['car', 'sports', 'spawn', 'vehicle']],
  ['BUZZOFF', 'Spawns a Hornet attack helicopter with its rotor already spinning.', ['helicopter', 'heli', 'spawn', 'chopper']],
  ['RHINO', 'Spawns a Gator M1 tank.', ['tank', 'spawn']],
  ['MONSTER', 'Spawns the Mardi Monster monster truck.', ['monster', 'truck', 'spawn']],
  ['ROCKET', 'Spawns a Hellcat 1000 motorbike.', ['bike', 'motorbike', 'motorcycle', 'spawn']],
  ['CATCHME', 'Toggles fast running.', ['run', 'fast', 'sprint']],
  ['HOPTOIT', 'Toggles super jump.', ['jump', 'super']],
  ['FLOATER', 'Toggles moon gravity.', ['gravity', 'moon', 'float']],
  ['SLOWMO', 'Toggles slow motion.', ['slow', 'motion', 'slowmo']],
  ['MAKEITRAIN', 'Toggles rain on and off.', ['rain', 'weather']],
  ['TIMEWARP', 'Skips the clock forward 6 hours.', ['time', 'clock', 'day', 'night']],
  ['TIMELAPSE', 'Toggles a fast-forward timelapse of the day/night cycle.', ['time', 'timelapse', 'day', 'night']],
  ['HIGHEX', 'Toggles explosive bullets.', ['explosive', 'bullet', 'ammo']],
  ['HOTHANDS', 'Toggles explosive punches (5× fist damage plus a big knock-back).', ['explosive', 'punch', 'fist']],
  ['SPEEDFREAK', 'Toggles turbo vehicles.', ['turbo', 'fast', 'car', 'speed']],
  ['SLIPPERY', 'Toggles drift mode.', ['drift', 'slide']],
  ['RIOT', 'Turns every civilian pedestrian into an armed, hostile gang member.', ['riot', 'gang', 'chaos']],
  ['ARMAGEDDON', 'For 20 seconds, rockets rain from the sky around you and nearby vehicles randomly explode.', ['armageddon', 'chaos', 'meteor']],
];

// ---------------------------------------------------------------- missions (missions.js)
const MISSIONS = [
  { id: 'race', title: 'Big D Street Race', city: 'Dallas', reward: 15000, color: '#ffcf33',
    desc: 'Four cars. One lap of Downtown Dallas. No rules.',
    how: 'Race three AI drivers for one lap of Downtown Dallas through the checkpoints. You must finish <b>1st</b>; any other place fails the mission.',
    kw: ['race', 'street', 'lap', 'racing'] },
  { id: 'express', title: 'Bayou Express', city: 'New Orleans', reward: 12000, color: '#8fd16a',
    desc: 'A van full of gumbo needs to be in Atlanta. Yesterday.',
    how: 'Take the Gumbo Delivery van from New Orleans to Atlanta. You have <b>170 seconds</b> once the clock starts. Use the interstate.',
    kw: ['express', 'delivery', 'van', 'gumbo', 'bayou'] },
  { id: 'rampage', title: 'Peach State Rampage', city: 'Atlanta', reward: 20000, color: '#ff4d4d',
    desc: 'Take the minigun. The Old Fourth Ward crew started it.',
    how: 'You are handed a minigun. Kill <b>35</b> targets within <b>80 seconds</b>.',
    kw: ['rampage', 'kill', 'peach'] },
  { id: 'monster', title: 'Mardi Gras Monster Mash', city: 'New Orleans', reward: 15000, color: '#b48cff',
    desc: 'Crush cars with a monster truck. Laissez les bons temps rouler!',
    how: 'Drive the Mardi Monster over cars to crush them. Crush <b>10</b> cars within <b>110 seconds</b>.',
    kw: ['monster', 'mash', 'crush', 'mardi', 'gras', 'truck'] },
  { id: 'heist', title: 'The Big D Heist', city: 'Dallas', reward: 250000, color: '#3dff6a',
    desc: 'Rob the Federal Reserve of Dallas and get the cash to the New Orleans safehouse.',
    how: 'Stand at the Federal Reserve entrance while the vault is cracked (the progress bar fills to 100%). That puts you at <b>4 stars</b>. Then get the cash to the <b>New Orleans safehouse</b>.',
    kw: ['heist', 'bank', 'rob', 'robbery', 'federal', 'reserve', 'vault'] },
  { id: 'skyfall', title: 'Skyfall Over The A', city: 'Atlanta', reward: 20000, color: '#4de1ff',
    desc: 'Fly the Hornet to 500m, bail out, and parachute onto the Capitol lawn.',
    how: 'Climb the Hornet helicopter above <b>500 m</b>, bail out with <kbd>F</kbd>, open the chute with <kbd>Space</kbd>, and land on the Georgia State Capitol lawn. The mission fails if you are out of the helicopter below 50 m during the climb.',
    kw: ['skyfall', 'parachute', 'skydive', 'helicopter', 'capitol', 'hornet'] },
];

// ---------------------------------------------------------------- weapons (player.js WEAPONS)
const WEAPONS = [
  { key: 'fist', name: 'Fists', slot: 1, dmg: 20, rate: 0.4, note: 'Melee. With the HOTHANDS cheat, punches do 5× damage and explode.' },
  { key: 'pistol', name: 'Pistol', slot: 2, dmg: 36, rate: 0.16, mag: 15, reload: 1.4, range: 220, max: 250, note: 'Semi-automatic and accurate. The best damage per shot of the bullet guns.' },
  { key: 'smg', name: 'Micro SMG', slot: 3, dmg: 20, rate: 0.075, mag: 30, reload: 1.9, range: 180, max: 600, note: 'Fully automatic, with the highest fire rate of the hand-held guns apart from the minigun.' },
  { key: 'shotgun', name: 'Pump Shotgun', slot: 4, dmg: 16, pellets: 9, rate: 0.85, mag: 8, reload: 2.6, range: 70, max: 80, note: 'Fires 9 pellets of 16 damage each (144 if every pellet hits). Short range.' },
  { key: 'rpg', name: 'RPG', slot: 5, rate: 1.1, mag: 1, reload: 2.4, max: 30, note: 'Fires an explosive rocket. One round per load.' },
  { key: 'minigun', name: 'Minigun', slot: 6, dmg: 24, rate: 0.03, range: 220, max: 5000, note: 'No magazine, so it never reloads. A free one sits on top of Atlanta\'s tallest tower.' },
];

// ---------------------------------------------------------------- vehicles (vehicles.js VEHICLE_TYPES)
const VEHICLES = [
  ['sedan', 'Oceanic LX', 'Sedan', 42, 900, ['sedan']],
  ['sports', 'Comet X', 'Sports car', 70, 800, ['sports', 'fastest', 'comet']],
  ['muscle', 'Dominator Bayou', 'Muscle car', 58, 1000, ['muscle', 'dominator']],
  ['pickup', 'Bison Lone Star', 'Texas pickup', 44, 1300, ['pickup', 'truck', 'bison']],
  ['police', 'Police Cruiser', 'Police car', 60, 1200, ['police', 'cop', 'cruiser', 'siren']],
  ['taxi', 'Downtown Cab', 'Taxi', 42, 900, ['taxi', 'cab']],
  ['van', 'Gumbo Delivery', 'Van', 36, 1300, ['van', 'gumbo', 'delivery']],
  ['bus', 'Transit Bus', 'Bus', 30, 2500, ['bus', 'transit']],
  ['bike', 'Hellcat 1000', 'Motorbike', 68, 500, ['bike', 'motorbike', 'motorcycle', 'hellcat']],
  ['monster', 'Mardi Monster', 'Monster truck (crushes cars)', 48, 4000, ['monster', 'truck', 'crush']],
  ['tank', 'Gator M1 Tank', 'Tank (crushes cars, cannon)', 22, 12000, ['tank', 'gator', 'cannon', 'military']],
  ['heli', 'Hornet Heli', 'Attack helicopter (rockets)', 55, 1500, ['helicopter', 'heli', 'hornet', 'chopper', 'rocket']],
  ['policeHeli', 'Police Eye', 'Police helicopter', 55, 1500, ['helicopter', 'police', 'chopper']],
];

// ---------------------------------------------------------------- cities (game/README.md)
const CITIES = [
  { id: 'dallas', name: 'Dallas', color: '#ffb347',
    districts: 'Downtown, Uptown, Deep Ellum, Oak Cliff, Fair Park, West End',
    landmarks: 'Reunion Tower (lit geodesic ball), Bank of America Plaza (green outline), Renaissance Tower (X lights), Fountain Place, Big Tex, the Texas Star Ferris wheel, the Federal Reserve, and a <b>MEGA RAMP</b>',
    extra: 'You start outside the Dallas safehouse. Deep Ellum has a gang that shoots back. Missions here: <i>Big D Street Race</i> and <i>The Big D Heist</i>.',
    kw: ['dallas', 'texas', 'reunion', 'ellum', 'ramp', 'tex'] },
  { id: 'nola', name: 'New Orleans', color: '#b48cff',
    districts: 'French Quarter, Marigny, Tremé, Garden District, CBD, Warehouse District',
    landmarks: 'the Superdome, St. Louis Cathedral, Jackson Square, St. Louis Cemetery No. 1, One Shell Square, and a paddle steamer on the Mississippi. The French Quarter has pastel buildings with wrought-iron balconies and Bourbon St neon',
    extra: 'Tremé has a gang that shoots back. Missions here: <i>Bayou Express</i> and <i>Mardi Gras Monster Mash</i>.',
    kw: ['orleans', 'nola', 'french', 'quarter', 'bourbon', 'superdome', 'treme', 'louisiana', 'mississippi'] },
  { id: 'atlanta', name: 'Atlanta', color: '#ff6b6b',
    districts: 'Downtown, Midtown, Buckhead, Old Fourth Ward, West End, Summerhill',
    landmarks: 'Bank of America Plaza (gold pyramid), Westin Peachtree, Truist Plaza, Mercedes-Benz Stadium (colour-cycling halo), the Georgia State Capitol (gold dome), and the SkyView wheel',
    extra: 'Old Fourth Ward has a gang that shoots back. A minigun pickup sits on top of the tallest tower, so bring a helicopter. A military depot east of the city has a tank parked in it. Missions here: <i>Peach State Rampage</i> and <i>Skyfall Over The A</i>.',
    kw: ['atlanta', 'atl', 'georgia', 'peachtree', 'buckhead', 'midtown', 'capitol'] },
];

const table = (head, rows) =>
  `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const README = 'game/README.md';
const UE = 'unreal/SouthernHeat/README.md';

// ---------------------------------------------------------------- entries
export const ENTRIES = [
  {
    id: 'overview', topic: 'Start', title: 'What is this project?',
    keywords: ['what', 'about', 'project', 'game', 'overview', 'southern', 'heat', 'gta', 'summary', 'repo', 'video'],
    source: 'README.md',
    answer: `<p><b>Grand Theft: Southern Heat</b> is a GTA V-style open-world game that runs in the browser. You drive, fly and fight across <b>Dallas</b>, <b>New Orleans</b> and <b>Atlanta</b>, which are linked by interstates.</p>
<ul><li>Built with <b>Three.js</b>, with no build step.</li><li>All geometry, textures and audio are procedural, so there are no asset files.</li><li>It plays in first person by default and has a 1–5 star wanted system, six missions, procedural radio and a day/night cycle.</li></ul>
<p>The repo also holds an <b>Unreal Engine 5 C++ version</b> in <code>unreal/SouthernHeat</code>, which builds the world at runtime.</p>
<p class="muted">It's a fan-made parody, not affiliated with Rockstar Games. All in-game brands are fictional.</p>`,
    followups: ['run', 'controls-foot', 'missions'],
  },
  {
    id: 'run', topic: 'Start', title: 'How do I run the game?',
    keywords: ['run', 'start', 'play', 'launch', 'install', 'serve', 'server', 'localhost', 'open', 'setup', 'http', 'python', 'host', 'pages', 'blank', 'module'],
    source: README,
    answer: `<p>Browsers block ES modules loaded from <code>file://</code>, so you have to serve the folder over HTTP:</p>
<pre><code>cd game
python3 -m http.server 8000
# then open http://localhost:8000</code></pre>
<p>Any static host also works, such as GitHub Pages or <code>npx serve</code>. Click <b>PLAY</b> and the game locks the mouse. It plays best with headphones.</p>
<p>Also included is <code>game/southern-heat-single.html</code>, a single-file build of the whole game in one HTML file.</p>`,
    followups: ['url-params', 'performance', 'controls-foot'],
  },
  {
    id: 'url-params', topic: 'Start', title: 'URL options',
    keywords: ['url', 'param', 'parameter', 'option', 'query', 'quality', 'hour', 'density', 'autostart', 'setting', 'traffic', 'skip', 'title'],
    source: README,
    answer: `<p>Add these to the game URL, for example <code>http://localhost:8000/?quality=low&amp;hour=22</code>:</p>
${table(['Param', 'Effect'], [
  ['<code>?quality=low</code>', 'No shadows, ambient occlusion or MSAA, 1× pixel ratio and half-resolution textures (for weaker GPUs)'],
  ['<code>?hour=22</code>', 'Start at a given hour (0–24)'],
  ['<code>?density=0.5</code>', 'Scale traffic and pedestrian density'],
  ['<code>?autostart</code>', 'Skip the title screen'],
])}`,
    followups: ['performance', 'daynight'],
  },
  {
    id: 'performance', topic: 'Start', title: 'It runs slowly / low graphics',
    keywords: ['slow', 'lag', 'fps', 'performance', 'low', 'graphics', 'laptop', 'gpu', 'stutter', 'framerate', 'quality', 'weak', 'crash', 'potato'],
    source: README + ', game/js/main.js',
    answer: `<p>Use low-graphics mode. Open the game with <code>?quality=low</code>. This turns off shadows, ambient occlusion and MSAA, uses a 1× pixel ratio and halves texture resolution.</p>
<p>The game remembers your quality choice in <code>localStorage</code> (key <code>gt-quality</code>). You can also add <code>?density=0.5</code> to halve traffic and pedestrians, which helps on weaker CPUs.</p>`,
    followups: ['url-params', 'mobile'],
  },
  {
    id: 'mobile', topic: 'Start', title: 'Can I play on a phone or tablet?',
    keywords: ['mobile', 'phone', 'tablet', 'touch', 'ipad', 'iphone', 'android', 'joystick', 'touchscreen'],
    source: 'game/js/input.js, game/index.html',
    answer: `<p>Yes. On touch devices the game shows <b>touch controls</b>: a virtual joystick at bottom-left for movement, action buttons at bottom-right, and you drag on the screen to look around.</p>
<p>It's a full 3D game, so on phones <code>?quality=low</code> is recommended.</p>`,
    followups: ['performance', 'run'],
  },
  {
    id: 'controls-foot', topic: 'Controls', title: 'Controls on foot',
    keywords: ['control', 'key', 'keyboard', 'mouse', 'foot', 'walk', 'move', 'wasd', 'sprint', 'jump', 'shoot', 'aim', 'reload', 'enter', 'button', 'keybind', 'binding'],
    source: README,
    answer: table(['Key', 'Action'], [
      [kbd('W A S D'), 'Move'], [kbd('Shift'), 'Sprint'], [kbd('Space'), 'Jump / open parachute'],
      [kbd('LMB'), 'Shoot'], [kbd('RMB'), 'Aim down sights'], [kbd('1–6') + ' / wheel', 'Switch weapons'],
      [kbd('F'), 'Enter or steal a car'], [kbd('R'), 'Reload'],
    ]) + `<p>Other keys: ${kbd('M')} map and GPS, ${kbd('T')} cheat console, ${kbd('V')} switch first/third person, ${kbd('H')} help, ${kbd('P')} / ${kbd('Esc')} pause.</p>`,
    followups: ['controls-drive', 'controls-heli', 'cheats'],
  },
  {
    id: 'controls-drive', topic: 'Controls', title: 'Driving controls',
    keywords: ['drive', 'driving', 'car', 'steer', 'gas', 'brake', 'reverse', 'handbrake', 'nitro', 'horn', 'siren', 'radio', 'exit', 'boost', 'drift'],
    source: README,
    answer: table(['Key', 'Action'], [
      [kbd('W') + ' / ' + kbd('S'), 'Gas / brake and reverse'], [kbd('A') + ' / ' + kbd('D'), 'Steer'],
      [kbd('Space'), 'Handbrake'], [kbd('Shift'), '<b>Nitro</b>'], [kbd('E'), 'Horn (siren in cop cars)'],
      [kbd('R'), 'Change radio station'], [kbd('F'), 'Get out (bail out at speed)'], [kbd('LMB'), 'Drive-by, or the cannon in a tank'],
    ]) + '<p>Driving uses arcade physics with drifting, ramps and airtime. Big jumps trigger a slow-motion stunt cam and a stunt bonus.</p>',
    followups: ['vehicles', 'controls-heli', 'radio'],
  },
  {
    id: 'controls-heli', topic: 'Controls', title: 'Helicopter controls',
    keywords: ['helicopter', 'heli', 'fly', 'flying', 'chopper', 'pilot', 'climb', 'descend', 'yaw', 'tilt', 'air', 'rocket'],
    source: README,
    answer: table(['Key', 'Action'], [
      [kbd('W') + ' / ' + kbd('S'), 'Tilt forward / back'], [kbd('A') + ' / ' + kbd('D'), 'Yaw (turn)'],
      [kbd('Space'), 'Climb'], [kbd('Shift'), 'Descend'], [kbd('LMB'), 'Rockets'], [kbd('F'), 'Bail out'],
    ]) + `<p>Each city's safehouse has a helicopter, and police stations have helipads. The <code>BUZZOFF</code> cheat spawns a Hornet attack helicopter next to you.</p>`,
    followups: ['parachute', 'mission-skyfall', 'cheat-buzzoff'],
  },
  {
    id: 'parachute', topic: 'Controls', title: 'Parachute & skydiving',
    keywords: ['parachute', 'chute', 'skydive', 'skydiving', 'bail', 'fall', 'swim', 'swimming', 'water'],
    source: README + ', game/js/main.js',
    answer: `<p>Bail out of a helicopter with ${kbd('F')}, then press ${kbd('Space')} to open the parachute. The <code>SKYFALL</code> cheat drops you from 800 m.</p>
<p>You can also <b>swim</b>. Cars that go into water sink, so get out.</p>`,
    followups: ['mission-skyfall', 'controls-heli'],
  },
  {
    id: 'camera', topic: 'Controls', title: 'First / third person camera',
    keywords: ['camera', 'view', 'first', 'third', 'person', 'perspective', 'fps', 'tps', 'switch'],
    source: README,
    answer: `<p>The game plays in <b>first person</b> by default. Press ${kbd('V')} to switch between first and third person.</p>
<p>In first person the weapon renders in its own pass with a narrower field of view, as real shooters do, so it never clips through walls.</p>`,
    followups: ['shooting', 'controls-foot'],
  },
  {
    id: 'shooting', topic: 'Combat', title: 'How does the gunplay work?',
    keywords: ['gunplay', 'shooting', 'shoot', 'recoil', 'spread', 'ads', 'aim', 'sights', 'magazine', 'reload', 'crosshair', 'headshot', 'accuracy', 'sway'],
    source: README,
    answer: `<ul>
<li><b>Magazines</b>: press ${kbd('R')}, or pull the trigger on an empty mag, to reload. The HUD shows <code>rounds in magazine / reserve</code>.</li>
<li><b>Aim down sights</b> with the right mouse button for a zoomed view with far less spread.</li>
<li><b>Recoil</b> climbs the view and then recovers. Sustained fire widens your spread, and the dynamic crosshair shows your current accuracy.</li>
<li>Sprinting lowers the gun. The weapon sways with the mouse and bobs as you walk.</li>
<li><b>Headshots</b>, drive-bys, the tank cannon and helicopter rockets all work.</li>
</ul>`,
    followups: ['weapons', 'wanted'],
  },
  {
    id: 'weapons', topic: 'Combat', title: 'Weapons list & stats',
    keywords: ['weapon', 'weapons', 'gun', 'guns', 'stat', 'stats', 'dps', 'best', 'arsenal', 'list', 'compare'],
    source: 'game/js/player.js',
    answer: `<p>Values read directly from <code>WEAPONS</code> in <code>player.js</code>. Fire rate is converted from the cooldown between shots.</p>` +
      table(['Key', 'Weapon', 'Damage', 'Rounds/min', 'Mag', 'Reload'], WEAPONS.map((w) => [
        kbd(w.slot), w.name,
        w.pellets ? `${w.dmg} × ${w.pellets}` : w.dmg ? w.dmg : 'Explosive',
        Math.round(60 / w.rate), w.mag || '—', w.reload ? w.reload + ' s' : '—',
      ])) + '<p>Use <code>TOOLUP</code> to get every weapon, and <code>FULLCLIP</code> for infinite ammo.</p>',
    followups: WEAPONS.map((w) => 'weapon-' + w.key).slice(1, 4),
  },
  {
    id: 'wanted', topic: 'Combat', title: 'Wanted level & police',
    keywords: ['wanted', 'police', 'cop', 'cops', 'star', 'stars', 'swat', 'escape', 'lose', 'evade', 'chase', 'pursuit', 'arrest', 'military', 'law'],
    source: README + ', game/js/police.js',
    answer: `<p>Crimes earn you 1–5 ★.</p>
<ul>
<li>Police cruisers path-find to you over the road graph. Officers get out, shoot, and try to arrest you.</li>
<li>Higher levels bring <b>SWAT vans</b> and <b>police helicopters</b>. At <b>5 stars the military sends a tank</b>.</li>
<li><b>To escape</b>, break line of sight and stay hidden until the search timer runs out. The timer is longer at higher levels: <code>7 + 3 × stars</code> seconds in <code>police.js</code>.</li>
</ul>
<p>What raises stars (from <code>police.js</code>): gunfire in a city, assault or carjacking (1★); stealing a cop car, killing with a vehicle, or explosions in a city (2★); killing a cop (at least 3★); taking a tank or doing the heist (4★).</p>`,
    followups: ['busted', 'cheat-lawyerup', 'cheat-leavemealone'],
  },
  {
    id: 'busted', topic: 'Combat', title: 'Busted or Wasted: what do I lose?',
    keywords: ['busted', 'wasted', 'die', 'death', 'dead', 'arrested', 'respawn', 'hospital', 'lose', 'penalty', 'fee', 'bail', 'killed'],
    source: 'game/js/main.js',
    answer: `<ul>
<li><b>WASTED</b> (you died): you respawn at the nearest hospital and pay a <b>$500</b> hospital bill.</li>
<li><b>BUSTED</b> (arrested): you respawn at the nearest police station, pay <b>$1,000</b> bail, and lose <b>half the ammo</b> for every weapon except fists and pistol.</li>
</ul>
<p>Either way your wanted level is cleared, and your money can't go below $0.</p>`,
    followups: ['wanted', 'save'],
  },
  {
    id: 'missions', topic: 'Missions', title: 'All six missions',
    keywords: ['mission', 'missions', 'quest', 'job', 'story', 'objective', 'list', 'reward', 'pay'],
    source: 'game/js/missions.js',
    answer: `<p>Each mission has a lettered marker in the world and on the map. Go to the marker to start it.</p>` +
      table(['Mission', 'City', 'Reward'], MISSIONS.map((m) => [`<span class="dot" style="background:${m.color}"></span>${m.title}`, m.city, money(m.reward)])) +
      `<p>Completed missions and your money are saved in <code>localStorage</code>.</p>`,
    followups: MISSIONS.slice(3, 6).map((m) => 'mission-' + m.id),
  },
  {
    id: 'cheats', topic: 'Cheats', title: 'Cheat codes',
    keywords: ['cheat', 'cheats', 'code', 'codes', 'console', 'hack', 'secret'],
    source: 'game/js/main.js',
    answer: `<p>Press ${kbd('T')} in game to open the cheat console, type a code, and press Enter.</p>` +
      table(['Code', 'Effect'], CHEATS.map(([c, d]) => [`<code>${c}</code>`, d])),
    followups: ['cheat-hesoyam', 'cheat-painkiller', 'cheat-rhino'],
  },
  {
    id: 'cities', topic: 'World', title: 'The map: three cities',
    keywords: ['map', 'world', 'city', 'cities', 'where', 'location', 'district', 'big', 'size', 'interstate', 'highway', 'causeway', 'landmark'],
    source: README,
    answer: table(['City', 'Districts'], CITIES.map((c) => [`<span class="dot" style="background:${c.color}"></span>${c.name}`, c.districts])) +
      `<p>The <b>I-20</b>, <b>I-49</b> and <b>I-59</b> interstates connect the cities, and the <b>Lake Pontchartrain Causeway</b> crosses the lake. Along the way you'll find billboards, truck stops, oil pumpjacks, bayou shacks, stunt ramps, and a military depot east of Atlanta with a tank.</p>
<p>Each city has a hospital, a police station with a helipad, and a safehouse with a car and a helicopter.</p>`,
    followups: CITIES.map((c) => 'city-' + c.id),
  },
  {
    id: 'gps', topic: 'World', title: 'Map, minimap & GPS',
    keywords: ['gps', 'waypoint', 'minimap', 'navigate', 'navigation', 'route', 'direction', 'lost', 'marker', 'hud'],
    source: README,
    answer: `<p>Press ${kbd('M')} for the full map. <b>Click</b> anywhere to set a GPS waypoint, and A* pathfinding plots a route over the road network. The HUD minimap rotates with you.</p>`,
    followups: ['cities', 'missions'],
  },
  {
    id: 'radio', topic: 'World', title: 'Radio stations',
    keywords: ['radio', 'music', 'station', 'song', 'country', 'brass', 'trap', 'sound', 'audio'],
    source: 'game/js/audio.js',
    answer: `<p>Three procedural stations are generated live with WebAudio. Press ${kbd('R')} while driving to cycle through them.</p>` +
      table(['Station', 'Genre'], [['KBIG 97.3', '<i>Lone Star Twang</i>: country'], ['WNOLA 88.9', '<i>Second Line Brass</i>'], ['HOT 404', '<i>Peach State Trap</i>'], ['Radio off', '—']]),
    followups: ['controls-drive', 'tech'],
  },
  {
    id: 'daynight', topic: 'World', title: 'Day/night cycle & weather',
    keywords: ['day', 'night', 'time', 'clock', 'weather', 'rain', 'sun', 'sunset', 'stars', 'sky', 'wet'],
    source: README,
    answer: `<p>A full day lasts <b>16 real minutes</b>. There's rain and a starry night sky. Roads and sidewalks get wet and reflective in the rain, then dry out afterwards.</p>
<p>To control it: <code>?hour=22</code> in the URL sets the start time. In game, <code>TIMEWARP</code> skips 6 hours, <code>TIMELAPSE</code> fast-forwards and <code>MAKEITRAIN</code> toggles rain.</p>`,
    followups: ['url-params', 'graphics'],
  },
  {
    id: 'vehicles', topic: 'Vehicles', title: 'All vehicles',
    keywords: ['vehicle', 'vehicles', 'car', 'cars', 'fastest', 'speed', 'top', 'mph', 'durable', 'health', 'list', 'garage', 'ride'],
    source: 'game/js/vehicles.js',
    answer: `<p>Values from <code>VEHICLE_TYPES</code>. Top speed is the rated <code>maxSpeed</code>, converted to mph the same way the HUD speedometer does, before nitro or the <code>SPEEDFREAK</code> cheat.</p>` +
      table(['Name', 'Type', 'Top speed', 'Durability'], VEHICLES.map(([, n, t, s, hp]) => [n, t, mph(s) + ' mph', hp.toLocaleString('en-US')])) +
      `<p>The fastest is the <b>Comet X</b> (${mph(70)} mph), and the toughest is the <b>Gator M1 Tank</b>. Damage builds from smoke to fire to explosion.</p>`,
    followups: ['vehicle-sports', 'vehicle-tank', 'controls-drive'],
  },
  {
    id: 'save', topic: 'Start', title: 'Does the game save?',
    keywords: ['save', 'saving', 'progress', 'load', 'persist', 'reset', 'lost', 'storage', 'localstorage'],
    source: README + ', game/js/main.js',
    answer: `<p>Yes. Money and completed missions are saved automatically in your browser's <code>localStorage</code>. Progress belongs to that browser and site address, so a private window or clearing site data starts you fresh.</p>`,
    followups: ['missions', 'busted'],
  },
  {
    id: 'graphics', topic: 'Tech', title: 'Graphics & rendering',
    keywords: ['graphics', 'rendering', 'render', 'bloom', 'ao', 'occlusion', 'pbr', 'material', 'shader', 'post', 'processing', 'visual', 'lighting', 'reflection'],
    source: README,
    answer: `<ul>
<li>A physically based sky, with image-based lighting and reflections baked from it.</li>
<li>Post-processing: ambient occlusion (GTAO), bloom, filmic tone mapping, colour grading, vignette and film grain. The screen edges turn red when you're badly hurt.</li>
<li>Physically based materials with normal, roughness and metalness maps. Brick shows mortar relief, office windows are glossy, and asphalt has aggregate, cracks, tyre tracks and oil stains.</li>
<li>Lit windows at night have ceiling-light gradients, blinds and silhouettes.</li>
<li>Cars have clear-coated metallic paint and glass greenhouses.</li>
</ul>`,
    followups: ['performance', 'tech'],
  },
  {
    id: 'tech', topic: 'Tech', title: 'Tech stack & code layout',
    keywords: ['tech', 'stack', 'code', 'source', 'file', 'files', 'layout', 'structure', 'three', 'threejs', 'javascript', 'js', 'how', 'built', 'made', 'engine', 'architecture', 'developer', 'contribute', 'modify'],
    source: README,
    answer: `<p>The game is plain ES-module JavaScript on a vendored <b>Three.js</b> (MIT) build, with no bundler. The code in <code>game/js/</code>:</p>` +
      table(['File', 'Responsibility'], [
        ['main.js', 'Game loop, camera, combat, sky/day-night, cheats, death/busted'],
        ['world.js', 'City generation, landmarks, highways, water, collision grid, road graph + A*'],
        ['vehicles.js', 'Vehicle models, driving/heli physics, damage, collisions'],
        ['ai.js', 'Traffic, police pursuit, racers, police helicopter AI'],
        ['people.js', 'Character rig, pedestrians, cops, gangs'],
        ['player.js', 'Player controller, weapons, parachute, swimming'],
        ['viewmodel.js', 'First-person hands and weapon models'],
        ['graphics.js', 'Sky, image-based lighting, post-processing'],
        ['police.js', 'Wanted level and police dispatch'],
        ['population.js', 'Spawning/despawning of traffic and peds'],
        ['missions.js', 'The six missions'],
        ['effects.js', 'Particles, explosions, tracers, rain'],
        ['audio.js', 'WebAudio SFX and procedural radio'],
        ['hud.js', 'HUD, minimap, full map, GPS'],
      ]),
    followups: ['unreal', 'graphics'],
  },
  {
    id: 'unreal', topic: 'Unreal', title: 'Unreal Engine 5 version',
    keywords: ['unreal', 'ue5', 'ue', 'engine', 'c++', 'cpp', 'visual', 'studio', 'compile', 'build', 'windows', 'uproject', 'native', 'pc'],
    source: UE,
    answer: `<p><code>unreal/SouthernHeat</code> is a C++ rebuild of the game for <b>UE 5.4</b> (5.3–5.5 should work). It generates the three cities, interstates, landmarks, cars and people at runtime from basic shapes, and uses Lumen and Sky Atmosphere for lighting. No art, maps or Blueprints are needed.</p>
<p><b>Build steps (Windows):</b></p>
<ol><li>Install UE 5.4 and Visual Studio 2022 with <i>Game development with C++</i>, <i>.NET desktop development</i>, MSVC v143 and a Windows SDK.</li>
<li>Right-click <code>SouthernHeat.uproject</code> → <b>Generate Visual Studio project files</b>.</li>
<li>Open <code>SouthernHeat.sln</code>, choose <b>Development Editor / Win64</b>, and build with <kbd>Ctrl+Shift+B</kbd>.</li>
<li>Press <kbd>F5</kbd>, then <b>Play</b> (<kbd>Alt+P</kbd>).</li></ol>
<p class="warn"><b>Honest status:</b> the README says this code was written without access to Unreal and <b>has never been compiled</b>, so expect the first build to report a few errors. It also has no audio yet.</p>`,
    followups: ['unreal-diff', 'tech'],
  },
  {
    id: 'unreal-diff', topic: 'Unreal', title: 'Browser vs Unreal differences',
    keywords: ['difference', 'compare', 'versus', 'vs', 'browser', 'unreal', 'better', 'which', 'cheat', 'console', 'tilde'],
    source: UE,
    answer: `<ul>
<li><b>Cheats</b>: in Unreal, press <kbd>~</kbd> and type <code>Cheat HESOYAM</code>, or just the code name. <code>FLOATER</code>, <code>MAKEITRAIN</code>, <code>HOTHANDS</code> and <code>SLIPPERY</code> aren't in the Unreal list.</li>
<li><b>Audio</b>: the browser version has full procedural SFX and radio. Unreal has no audio yet.</li>
<li><b>Map</b>: in Unreal, left click sets a GPS waypoint and right click clears it. Gamepads are mapped too.</li>
<li><b>Status</b>: the browser game is the playable one. The Unreal project hasn't been compiled yet.</li>
</ul>
<p>The UE README suggests going further with MetaHumans, Quixel Megascans / Fab packs, Chaos Vehicles and MetaSounds.</p>`,
    followups: ['unreal', 'cheats'],
  },
  {
    id: 'stunts', topic: 'Vehicles', title: 'Stunts, ramps & nitro',
    keywords: ['stunt', 'stunts', 'ramp', 'jump', 'airtime', 'nitro', 'boost', 'mega', 'flip', 'bonus'],
    source: README,
    answer: `<p>Press ${kbd('Shift')} in a car for <b>nitro</b>. Stunt ramps are scattered along the highways, and Dallas has a <b>MEGA RAMP</b>. Big airtime triggers a slow-motion stunt cam and pays a <b>stunt bonus</b>.</p>`,
    followups: ['vehicles', 'city-dallas'],
  },
  {
    id: 'gangs', topic: 'World', title: 'Gangs & pedestrians',
    keywords: ['gang', 'gangs', 'pedestrian', 'peds', 'npc', 'people', 'civilian', 'traffic', 'hostile'],
    source: README,
    answer: `<p>Traffic follows lanes, brakes and honks. Pedestrians walk the blocks, cross streets and panic at gunfire. Gangs in <b>Deep Ellum</b> (Dallas), <b>Tremé</b> (New Orleans) and <b>Old Fourth Ward</b> (Atlanta) shoot back. The <code>RIOT</code> cheat makes every civilian hostile.</p>`,
    followups: ['wanted', 'cheat-riot'],
  },
  {
    id: 'license', topic: 'Start', title: 'License & credits',
    keywords: ['license', 'licence', 'legal', 'rockstar', 'copyright', 'credit', 'affiliated', 'parody', 'mit'],
    source: README,
    answer: `<p>The game is a fan-made <b>parody</b> and isn't affiliated with Rockstar Games. All in-game brands are fictional. Three.js is vendored under its MIT licence (<code>game/lib/THREE_LICENSE</code>), and ChatVue vendors Vue 3 under MIT (<code>chatvue/lib/VUE_LICENSE</code>).</p>`,
    followups: ['overview'],
  },
];

// per-item entries
for (const [code, desc, kw] of CHEATS) {
  ENTRIES.push({
    id: 'cheat-' + code.toLowerCase(), topic: 'Cheats', title: `Cheat: ${code}`, hidden: true, code,
    keywords: [code.toLowerCase(), 'cheat', ...kw], source: 'game/js/main.js',
    answer: `<p><code class="big">${code}</code></p><p>${desc}</p><p class="muted">Press ${kbd('T')} in game, type <code>${code}</code>, then press Enter.</p>`,
    followups: ['cheats'],
  });
}
for (const m of MISSIONS) {
  ENTRIES.push({
    id: 'mission-' + m.id, topic: 'Missions', title: m.title, hidden: true,
    keywords: [...m.kw, 'mission', ...m.title.toLowerCase().split(/\s+/)], source: 'game/js/missions.js',
    answer: `<p><span class="dot" style="background:${m.color}"></span><b>${m.title}</b>: ${m.city} · reward <b>${money(m.reward)}</b></p>
<blockquote>${m.desc}</blockquote><p>${m.how}</p>`,
    followups: ['missions'],
  });
}
for (const w of WEAPONS) {
  const rows = [['Slot', kbd(w.slot)], ['Damage', w.pellets ? `${w.dmg} × ${w.pellets} pellets` : w.dmg || 'Explosive rocket'],
    ['Fire rate', `${Math.round(60 / w.rate)} rounds/min`]];
  if (w.mag) rows.push(['Magazine', w.mag], ['Reload', w.reload + ' s']);
  if (w.range) rows.push(['Range', w.range + ' m']);
  if (w.max) rows.push(['Max ammo', w.max.toLocaleString('en-US')]);
  ENTRIES.push({
    id: 'weapon-' + w.key, topic: 'Combat', title: w.name, hidden: true,
    keywords: [w.key, ...w.name.toLowerCase().split(/\s+/), 'weapon', 'gun'], source: 'game/js/player.js',
    answer: table(['Stat', w.name], rows) + `<p>${w.note}</p>`,
    followups: ['weapons', 'shooting'],
  });
}
for (const [key, name, type, speed, hp, kw] of VEHICLES) {
  ENTRIES.push({
    id: 'vehicle-' + key, topic: 'Vehicles', title: name, hidden: true,
    keywords: [...kw, ...name.toLowerCase().split(/\s+/), 'vehicle'], source: 'game/js/vehicles.js',
    answer: `<p><b>${name}</b>: ${type}</p>` + table(['Stat', 'Value'], [['Rated top speed', mph(speed) + ' mph'], ['Durability', hp.toLocaleString('en-US')]]) +
      ({ sports: '<p>Spawn one any time with <code>COMET</code>.</p>', tank: '<p>Spawn with <code>RHINO</code>. One is also parked at the military depot east of Atlanta. Taking a tank gives you 4★, and at 5★ the military sends one after you.</p>',
        monster: '<p>Spawn with <code>MONSTER</code>. Drive over cars to crush them.</p>', bike: '<p>Spawn with <code>ROCKET</code>.</p>',
        heli: '<p>Spawn with <code>BUZZOFF</code>. Fire rockets with the left mouse button.</p>', police: '<p>Press <kbd>E</kbd> for the siren. Stealing one gives you 2★.</p>' }[key] || ''),
    followups: ['vehicles'],
  });
}
for (const c of CITIES) {
  ENTRIES.push({
    id: 'city-' + c.id, topic: 'World', title: c.name, hidden: true,
    keywords: [...c.kw, 'city'], source: README,
    answer: `<p><span class="dot" style="background:${c.color}"></span><b>${c.name}</b></p><p><b>Districts:</b> ${c.districts}.</p><p><b>Landmarks:</b> ${c.landmarks}.</p><p>${c.extra}</p>`,
    followups: ['cities', 'missions'],
  });
}

export const CHEAT_CODES = CHEATS.map(([c]) => c);
export const STARTERS = ['How do I run the game?', 'What cheat gives money?', 'How do I lose the cops?', 'Best weapon?', 'Fastest car?', 'How does the bank heist work?'];
