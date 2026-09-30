// Shared types for Grand Theft: Southern Heat.
// Gameplay design numbers are written in metres and converted with SH::M.
#pragma once

#include "CoreMinimal.h"

namespace SH
{
	constexpr float M = 100.f; // centimetres per metre

	// World layout uses the same (x, z) metre coordinates as the browser version:
	// x runs east, z runs south. In Unreal, X = east, Y = south, Z = up.
	inline FVector W(float X, float Z, float Up = 0.f) { return FVector(X * M, Z * M, Up * M); }

	inline FLinearColor Hex(const TCHAR* H) { return FLinearColor(FColor::FromHex(H)); }

	inline float Rand(float A, float B) { return FMath::FRandRange(A, B); }
	inline bool Chance(float P) { return FMath::FRand() < P; }
}

enum class ESHVehicleKind : uint8
{
	Sedan, Sports, Muscle, Pickup, Police, Taxi, Van, Bus, Bike, Monster, Tank, Heli, PoliceHeli, Count
};

struct FSHVehicleDef
{
	const TCHAR* Name;
	float Len, Wid, Hgt;          // metres
	float MaxSpeed, Accel, Brake;  // m/s, m/s^2
	float Steer, Grip, Mass, HP, WheelR;
	bool bHeli = false;
	bool bCrusher = false;
	bool bPolice = false;
};

inline const FSHVehicleDef& SHVehicleDef(ESHVehicleKind K)
{
	static const FSHVehicleDef Defs[] = {
		{ TEXT("Oceanic LX"),      4.6f, 1.9f, 1.5f, 42, 14, 32, 1.0f, 7, 1.2f, 900, 0.36f },
		{ TEXT("Comet X"),         4.4f, 2.0f, 1.2f, 70, 30, 42, 1.15f, 9, 1.0f, 800, 0.36f },
		{ TEXT("Dominator Bayou"), 4.9f, 2.0f, 1.35f, 58, 25, 34, 0.95f, 5.5f, 1.4f, 1000, 0.38f },
		{ TEXT("Bison Lone Star"), 5.4f, 2.1f, 1.9f, 44, 16, 30, 0.9f, 6.5f, 1.8f, 1300, 0.45f },
		{ TEXT("Police Cruiser"),  4.9f, 1.95f, 1.55f, 60, 24, 38, 1.05f, 8, 1.5f, 1200, 0.37f, false, false, true },
		{ TEXT("Downtown Cab"),    4.7f, 1.9f, 1.5f, 42, 14, 32, 1.0f, 7, 1.2f, 900, 0.36f },
		{ TEXT("Gumbo Delivery"),  5.4f, 2.1f, 2.5f, 36, 11, 26, 0.85f, 6, 2.0f, 1300, 0.4f },
		{ TEXT("Transit Bus"),     11.f, 2.6f, 3.2f, 30, 8, 20, 0.7f, 6, 5.0f, 2500, 0.55f },
		{ TEXT("Hellcat 1000"),    2.2f, 0.8f, 1.2f, 68, 32, 40, 1.4f, 8, 0.5f, 500, 0.34f },
		{ TEXT("Mardi Monster"),   5.6f, 3.2f, 3.4f, 48, 22, 34, 0.9f, 6, 6.0f, 4000, 1.15f, false, true },
		{ TEXT("Gator M1 Tank"),   7.8f, 3.6f, 2.8f, 22, 9, 26, 0.7f, 14, 20.f, 12000, 0.5f, false, true },
		{ TEXT("Hornet Heli"),     10.f, 2.4f, 3.0f, 55, 20, 0, 1, 1, 3.0f, 1500, 0, true },
		{ TEXT("Police Eye"),      10.f, 2.4f, 3.0f, 55, 20, 0, 1, 1, 3.0f, 1500, 0, true, false, true },
	};
	return Defs[FMath::Clamp((int32)K, 0, (int32)ESHVehicleKind::Count - 1)];
}

struct FSHRoadNode
{
	FVector2D P;          // metres
	TArray<int32> Edges;
	int32 City = -1;      // -1 = highway
};

struct FSHRoadEdge
{
	int32 A = 0, B = 0;
	float Len = 0;
	bool bHighway = false;
	int32 Other(int32 N) const { return N == A ? B : A; }
};

struct FSHCityDef
{
	FString Name;
	FString Tagline;
	float CX, CZ;          // metres
	float MaxH;            // tallest generic building
	float Falloff;
	FLinearColor Color;
};

enum class ESHCrime : uint8 { Gunfire, Assault, Murder, CopKill, CopAssault, StealCop, Carjack, Explosion, VehicleKill, Tank, Heist };

enum class ESHWeapon : uint8 { Fist, Pistol, SMG, Shotgun, RPG, Minigun, Count };

struct FSHWeaponDef
{
	const TCHAR* Name;
	float Rate, Damage, Spread, Range;
	int32 Pellets;
	bool bAuto, bRocket, bMelee;
	int32 Give, Max;
};

inline const FSHWeaponDef& SHWeaponDef(ESHWeapon W)
{
	static const FSHWeaponDef Defs[] = {
		{ TEXT("Fists"),        0.40f, 20, 0,     1.9f, 1, false, false, true,  0,    0 },
		{ TEXT("Pistol"),       0.20f, 36, 0.008f, 220, 1, false, false, false, 60,   250 },
		{ TEXT("Micro SMG"),    0.075f, 20, 0.03f, 180, 1, true,  false, false, 180,  600 },
		{ TEXT("Pump Shotgun"), 0.85f, 16, 0.07f, 70,  9, false, false, false, 24,   80 },
		{ TEXT("RPG"),          1.10f, 0,  0,     0,   1, false, true,  false, 8,    30 },
		{ TEXT("Minigun"),      0.03f, 24, 0.04f, 220, 1, true,  false, false, 1500, 5000 },
	};
	return Defs[FMath::Clamp((int32)W, 0, (int32)ESHWeapon::Count - 1)];
}
