// Procedurally builds Dallas, New Orleans and Atlanta, the interstates between
// them, landmarks, water and lighting. Also owns the road graph used by the AI.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SHTypes.h"
#include "SHWorldBuilder.generated.h"

class UInstancedStaticMeshComponent;
class UDirectionalLightComponent;
class USkyAtmosphereComponent;
class USkyLightComponent;
class UExponentialHeightFogComponent;
class UStaticMesh;

struct FSHBlock { FVector2D C; int32 City = 0; FString District; bool bOpen = false; };
struct FSHSpot { FVector2D P; float Yaw = 0; int32 City = 0; bool bPolice = false; TWeakObjectPtr<AActor> Car; bool bCooldown = false; };
struct FSHSpecial { ESHVehicleKind Kind = ESHVehicleKind::Sedan; FVector2D P; float Yaw = 0; float Up = 0; TWeakObjectPtr<AActor> Car; };
struct FSHRect { float MinX, MaxX, MinZ, MaxZ; FString Name; };
struct FSHSeg { FVector2D A, B; FString Name; bool bBridge = false; };
struct FSHLabel { FString Text; FVector2D P; FLinearColor Color = FLinearColor::White; int32 Kind = 0; }; // 0 landmark, 1 city, 2 icon
struct FSHPickup { ESHWeapon Weapon = ESHWeapon::Pistol; int32 Type = 0; FVector2D P; float Up = 0; float Respawn = 0; TWeakObjectPtr<AActor> Visual; }; // Type 0 weapon, 1 health, 2 armor

UCLASS()
class SOUTHERNHEAT_API ASHWorldBuilder : public AActor
{
	GENERATED_BODY()

public:
	ASHWorldBuilder();
	virtual void Tick(float DeltaSeconds) override;

	void Build();
	void SetTimeOfDay(float Hour);

	// ---- lighting
	UPROPERTY() TObjectPtr<USceneComponent> Root;
	UPROPERTY() TObjectPtr<UDirectionalLightComponent> Sun;
	UPROPERTY() TObjectPtr<UDirectionalLightComponent> Moon;
	UPROPERTY() TObjectPtr<USkyAtmosphereComponent> Atmosphere;
	UPROPERTY() TObjectPtr<USkyLightComponent> SkyLight;
	UPROPERTY() TObjectPtr<UExponentialHeightFogComponent> Fog;

	// ---- data (all in metres, x east / z south)
	TArray<FSHCityDef> Cities;
	TArray<FSHRoadNode> Nodes;
	TArray<FSHRoadEdge> Edges;

	TArray<FSHBlock> Blocks;

	TArray<FSHSpot> ParkingSpots;

	TArray<FSHSpecial> Specials;

	TArray<FSHRect> Waters;

	TArray<FSHSeg> Highways;

	TArray<FSHLabel> Labels;

	TArray<FSHPickup> Pickups;

	TArray<FVector2D> Hospitals, PoliceStations, Safehouses;
	TArray<int32> SafehouseCity;
	FVector2D Bank;

	// ---- queries
	bool IsWater(float X, float Z) const;
	int32 CityAt(float X, float Z, float Pad = 0.f) const;
	FString ZoneName(float X, float Z, FString& OutCity, FLinearColor& OutColor) const;
	int32 NearestNode(float X, float Z) const;
	bool FindPath(int32 From, int32 To, TArray<int32>& Out) const;
	float GroundZ(const FVector& AtCm, float Above = 300.f) const;   // returns cm
	bool LineOfSight(const FVector& A, const FVector& B, const AActor* IgnoreA = nullptr, const AActor* IgnoreB = nullptr) const;

	// ---- geometry helpers (metres). Boxes: centre x/z, bottom y0.
	void Box(float X, float Z, float Y0, float W, float D, float H, const FLinearColor& C, float YawDeg = 0.f, bool bCollide = true);
	void Cyl(float X, float Z, float Y0, float Diam, float H, const FLinearColor& C, bool bCollide = true);
	void Ball(float X, float Z, float YCentre, float Diam, const FLinearColor& C, float SquashY = 1.f);
	void ConeAt(float X, float Z, float Y0, float Diam, float H, const FLinearColor& C);
	void Text(const FString& Str, float X, float Z, float Y, float YawDeg, float SizeM, const FColor& C);

private:
	UPROPERTY() TMap<FString, TObjectPtr<UInstancedStaticMeshComponent>> ISMs;
	UInstancedStaticMeshComponent* GetISM(UStaticMesh* Mesh, const FLinearColor& C, bool bCollide);
	void AddInstance(UStaticMesh* Mesh, const FLinearColor& C, bool bCollide, const FTransform& T);

	void BuildGround();
	void BuildCity(int32 Ci);
	void BuildBlock(int32 Ci, int32 I, int32 J);
	void BuildBuildings(int32 Ci, float BX, float BZ, float MaxH, const FString& District, bool bSmall, bool bPastel, bool bBrick);
	bool BuildSpecial(int32 Ci, const FString& Type, float BX, float BZ);
	void BuildPark(float BX, float BZ, int32 Trees, bool bPalms);
	void BuildParking(int32 Ci, float BX, float BZ);
	void Building(float X, float Z, float W, float D, float H, const FLinearColor& Wall, int32 Style, float Y0 = 0.f);
	void Balconies(float X, float Z, float W, float D, float H);
	void Ferris(float X, float Z, float Radius, float YawDeg, const FLinearColor& C);
	void BuildHighways();
	void BuildWater();
	void BuildCountryside();
	void BuildTrees();
	void Ramp(float X, float Z, float YawDeg, float Len, float Height, float Width);
	void Tree(float X, float Z, float S, int32 Kind);

	int32 AddNode(float X, float Z, int32 City);
	void AddEdge(int32 A, int32 B, bool bHwy);
	float DistToHighway(float X, float Z) const;

	TMap<FIntPoint, int32> NodeMap;
	UPROPERTY() TArray<TObjectPtr<USceneComponent>> Spinners;
	FRandomStream Rng;
};
