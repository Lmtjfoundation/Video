# Grand Theft: Southern Heat (Unreal Engine 5)

This is the Unreal Engine 5 version of the browser game in [`../../game`](../../game). It's a C++ project. When you press Play, the game generates Dallas, New Orleans and Atlanta in code, along with the interstates, landmarks, cars, people and lighting.

You don't need any art, maps or Blueprints. The project uses only the engine's built-in basic shapes, and the lighting comes from Lumen, Sky Atmosphere and a moving sun.

> **Status:** I wrote this code without access to Unreal, so it has never been compiled. It targets UE 5.4 and is written against the standard engine API. Expect the first build to report a few errors. Send me the error text from the Output Log or Visual Studio and I'll fix them.

## What you need

- **Windows 10/11.** Mac works too with Xcode, but these steps assume Windows.
- **Unreal Engine 5.4**, installed from the Epic Games Launcher. Versions 5.3 to 5.5 should also work.
- **Visual Studio 2022** (the free Community edition is fine). During install, tick these workloads:
  - **Game development with C++**
  - **.NET desktop development**
  - In "Individual components": **MSVC v143 build tools** and a **Windows 10/11 SDK**

## Build and run

1. Copy the `SouthernHeat` folder (the one containing `SouthernHeat.uproject`) somewhere on your PC, for example `Documents\Unreal Projects\SouthernHeat`.
2. Right-click **`SouthernHeat.uproject`** and choose **Generate Visual Studio project files**.
   - If that option is missing, double-click the `.uproject` instead and click **Yes** when it asks to rebuild modules.
3. Open **`SouthernHeat.sln`** in Visual Studio. Set the configuration to **Development Editor** and the platform to **Win64**, then press **Ctrl+Shift+B** to build.
4. Press **F5**, or double-click `SouthernHeat.uproject`, to open the editor.
5. Press **Play** (Alt+P). Click inside the viewport so it captures the mouse.

The project opens the engine's empty **Entry** map, and the game mode builds the whole world on top of it. If your engine version doesn't have that map, do this instead:

1. Go to **File > New Level > Empty Level**.
2. Save it as `Content/Maps/Main`.
3. In **Project Settings > Maps & Modes**, set it as both the Editor Startup Map and the Game Default Map.

## Controls

| On foot | | Driving | | Helicopter | |
|---|---|---|---|---|---|
| WASD | Move | W / S | Gas / brake-reverse | W / S | Tilt forward / back |
| Shift | Sprint | A / D | Steer | A / D | Turn |
| Space | Jump / open parachute | Space | Handbrake | Space | Climb |
| LMB | Shoot | Shift | Nitro | Shift | Descend |
| RMB | Aim | E | Siren (police cars) | LMB | Rockets |
| Wheel | Change weapon | LMB | Drive-by / tank cannon | F | Bail out |
| F | Steal / enter car | F | Exit (bail out at speed) | | |

Other keys: **M** opens the full map (left click sets a GPS waypoint, right click clears it), and **H** shows help. Gamepads are mapped too.

**Cheats:** press **~** to open the console, then type `Cheat HESOYAM`. You can also type the name directly, for example `RHINO`.

`HESOYAM TURTLE PAINKILLER TOOLUP FULLCLIP LAWYERUP FUGITIVE LEAVEMEALONE SKYFALL COMET BUZZOFF RHINO MONSTER ROCKET CATCHME HOPTOIT SLOWMO TIMEWARP TIMELAPSE HIGHEX SPEEDFREAK RIOT ARMAGEDDON`

## What's in it

- **Three cities on a 6.6 km world.**
  - **Dallas:** Reunion Tower, Bank of America Plaza with its green outline, Fountain Place, Big Tex and the Texas Star Ferris wheel, the Federal Reserve, and a mega ramp.
  - **New Orleans:** the Superdome, St. Louis Cathedral, and French Quarter buildings with iron balconies.
  - **Atlanta:** Bank of America Plaza with its gold top, Westin Peachtree, Mercedes-Benz Stadium, the Capitol dome, and the SkyView wheel.
  - **Between them:** I-20, I-49 and I-59, the Lake Pontchartrain Causeway, the Mississippi, truck stops, oil pumpjacks, and a military depot with a tank.
- **Vehicles:** sedans, sports cars, muscle cars, pickups, taxis, vans, buses, bikes, police cars, a monster truck, a tank and helicopters. Driving is arcade-style with drifting and nitro. Ramps give slow-motion stunt bonuses. Cars take damage, catch fire and explode, and they sink in water.
- **People:** jointed human characters with faces, hair, hats and varied clothing. Pedestrians walk their blocks and cross streets, and they panic at gunfire. Gangs in Deep Ellum, Tremé and the Old Fourth Ward fight back.
- **Wanted system (1–5 stars):**
  - Police use pathfinding over the road graph to reach you.
  - Officers get out of their cars to shoot or arrest you, and you can get **BUSTED**.
  - From 3 stars, SWAT vans and helicopters join in.
  - At 5 stars, a tank comes after you.
  - Break line of sight to escape.
- **Six missions:** a street race, a timed delivery, a rampage, a monster truck crush, a bank heist, and a skydive.
- **Other features:** a day/night cycle, a minimap with GPS routing, and a full map.

## Code layout

| File | What it does |
|---|---|
| `SHGameMode` | Startup, traffic and pedestrian spawning, wanted system, combat, explosions, missions, cheats |
| `SHWorldBuilder` | City and highway generation, landmarks, lighting and time of day, road graph with A* pathfinding |
| `SHVehicle` | Vehicle pawn: models, driving and helicopter physics, damage, AI (traffic, police, racers) |
| `SHPlayerCharacter` | Player on foot: movement, weapons, parachute, swimming |
| `SHPed` | Pedestrians, cops, SWAT and gangs |
| `SHHuman` | Jointed character model built from basic shapes, with procedural animation |
| `SHHUD` | Minimap, map, stars, money and messages (drawn on the Canvas) |
| `SHPlayerController` | Map input and console cheats |
| `SHFx` | Explosions, tracers, rockets and pickups |

## Taking it further in Unreal

This version uses only primitive shapes so that it works without importing anything. Here's how to get closer to GTA V:

- **Characters:** swap in real character models and animations, such as Unreal's free **MetaHumans** or the Mannequin with Animation Blueprints.
- **Environment:** use Quixel Megascans or Fab building packs for the cities.
- **Car physics:** move the cars onto **Chaos Vehicles** for full suspension physics.
- **Sound:** add effects and music with MetaSounds. This version has no audio yet.
