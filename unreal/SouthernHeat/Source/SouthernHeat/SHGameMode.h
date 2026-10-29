// Game rules for Grand Theft: Southern Heat: builds the world at startup, spawns
// traffic and pedestrians, runs the wanted system, missions, combat, cheats and
// the day/night cycle. Everything is generated in code, so no map or art assets are needed.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "SHTypes.h"
#include "SHGameMode.generated.h"

class AController;
class ASHWorldBuilder;
class ASHVehicle;
class ASHPed;
class ASHPlayerCharacter;
class ASHProp;
class UStaticMesh;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UStaticMeshComponent;

struct FSHMission
{
	int32 Id = 0;
	FString Title, Desc, City;
	FVector2D Marker;
	int32 Reward = 0;
	FLinearColor Color = FLinearColor::White;
	TCHAR Letter = 'M';
};

UCLASS()
class SOUTHERNHEAT_API ASHGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ASHGameMode();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void RestartPlayer(AController* NewPlayer) override;

	static ASHGameMode* Get(const UObject* WorldContext);

	// ------------------------------------------------------------ assets
	UPROPERTY() TObjectPtr<UStaticMesh> CubeMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> CylinderMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> SphereMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> ConeMesh;
	UPROPERTY() TObjectPtr<UMaterialInterface> BaseMaterial;
	UPROPERTY() TMap<FString, TObjectPtr<UMaterialInstanceDynamic>> MatCache;
	void EnsureAssets();
	UMaterialInstanceDynamic* ColorMat(const FLinearColor& C);
	// Adds a primitive part. LocCm is relative to Parent, SizeM is the size in metres.
	UStaticMeshComponent* AddPart(AActor* OwnerActor, USceneComponent* Parent, UStaticMesh* Mesh, const FVector& LocCm, const FVector& SizeM, const FLinearColor& Color, const FRotator& Rot = FRotator::ZeroRotator);

	// ------------------------------------------------------------- world
	UPROPERTY() TObjectPtr<ASHWorldBuilder> World;
	UPROPERTY() TArray<TObjectPtr<ASHVehicle>> Vehicles;
	UPROPERTY() TArray<TObjectPtr<ASHPed>> Peds;
	UPROPERTY() TObjectPtr<ASHPlayerCharacter> PlayerChar;
	UPROPERTY() TObjectPtr<ASHVehicle> PlayerVehicle;
	TArray<AActor*> PedActors() const;
	FVector PlayerPos() const;
	float Hour = 16.5f;
	bool bWorldBuilt = false;
	UPROPERTY() TArray<TObjectPtr<AController>> PendingPlayers;

	// ----------------------------------------------------- player status
	int64 Money = 5000;
	float Nitro = 1.f;
	bool bPlayerDead = false;
	float RespawnTimer = 0.f;
	bool bRespawnAtPolice = false;
	float BustAccum = 0.f, BustSeen = -10.f;
	int32 Kills = 0, Stunts = 0, CarsStolen = 0;

	// ------------------------------------------------------------ cheats
	bool bGodMode = false, bInfiniteAmmo = false, bNeverWanted = false, bFastRun = false, bSuperJump = false;
	bool bExplosiveAmmo = false, bFastCars = false, bSlowMo = false, bTimelapse = false;
	float Armageddon = 0.f;
	bool ApplyCheat(const FString& Code);

	// ---------------------------------------------------------- messages
	FString BigText, BigSub, HelpText, HintText, Objective, StuntText, StuntSub;
	FLinearColor BigColor = FLinearColor::White;
	float BigTimer = 0.f, HelpTimer = 0.f, HintTimer = 0.f, StuntTimer = 0.f, DamageFlash = 0.f;
	void ShowBig(const FString& Text, const FLinearColor& Color, float Duration, const FString& Sub = FString());
	void ShowHelp(const FString& Text, float Duration = 6.f);
	void ShowHint(const FString& Text);
	FString LastCity;

	// -------------------------------------------------------------- wanted
	int32 WantedLevel = 0;
	bool bWantedSeen = false;
	float SearchTimer = 0.f, WantedSpawnCd = 0.f;
	int32 WantedKills = 0;
	bool bWantedLocked = false;
	UPROPERTY() TArray<TObjectPtr<ASHVehicle>> PoliceUnits;
	void ReportCrime(ESHCrime Crime, const FVector& At);
	void SetWanted(int32 Level);
	void ClearWanted();
	void SpawnCopsFromCar(ASHVehicle* V);
	void TryBust(float Dt);

	// ----------------------------------------------------------- vehicles
	// Paint with negative alpha = random colour for the vehicle type
	ASHVehicle* SpawnVehicle(ESHVehicleKind Kind, const FVector2D& PosM, float YawDeg, float UpM = 0.f, const FLinearColor& Paint = FLinearColor(0.f, 0.f, 0.f, -1.f));
	void TryEnterNearestVehicle();
	void EnterVehicle(ASHVehicle* V, bool bQuiet = false);
	void ExitVehicle(bool bForce = false);

	// ------------------------------------------------------------- combat
	FVector AimPoint(const FVector& CamLoc, const FVector& CamFwd, const AActor* Ignore) const;
	void FireBullet(const FVector& Start, const FVector& Dir, float Damage, float RangeCm, AActor* Ignore, bool bByPlayer, bool bTracer = true);
	void NpcShoot(const FVector& From, float Accuracy, float Damage, AActor* Shooter);
	void SpawnRocket(const FVector& From, const FVector& Dir, AActor* Shooter, bool bByPlayer, float SpeedCmS, float RadiusM);
	void Explode(const FVector& At, float RadiusM, bool bByPlayer, AActor* Ignore);
	void PunchFrom(AActor* Puncher, const FVector& At, const FVector& Fwd);
	void SpawnBlood(const FVector& At);
	void SpawnPuff(const FVector& At, const FLinearColor& Color, float SizeM, float Life);
	void SpawnTracer(const FVector& A, const FVector& B, const FLinearColor& Color);
	void RunOver(ASHVehicle* V);

	// ------------------------------------------------------------- events
	void OnPlayerGunfire(const FVector& At);
	void OnPlayerHurtPed(ASHPed* P, bool bKilled);
	void OnPedKilled(ASHPed* P, bool bByPlayer);
	void OnVehicleDestroyed(ASHVehicle* V);
	void OnVehicleSunk(ASHVehicle* V);
	void OnVehicleCrash(ASHVehicle* V, float ImpactMs, const FVector& At);
	void OnVehicleCollision(ASHVehicle* A, ASHVehicle* B, float SpeedMs);
	void OnCrush(ASHVehicle* Victim, ASHVehicle* By);
	void OnPlayerLanded(ASHVehicle* V, float ImpactMs);
	void PlayerDied();
	void Busted();
	void Respawn();

	// ------------------------------------------------------------ missions
	TArray<FSHMission> Missions;
	TSet<int32> Completed;
	int32 Active = -1;
	int32 Stage = 0;
	float MissionTimer = -1.f;
	float MissionClock = 0.f;
	float MissionCooldown = 0.f;
	int32 MissionCount = 0;
	float Progress = 0.f;
	TArray<FVector2D> RouteCps;
	int32 CpIdx = 0;
	bool bHasGps = false;
	FVector2D Gps;
	bool bHasWaypoint = false;
	FVector2D Waypoint;
	UPROPERTY() TArray<TObjectPtr<AActor>> MissionActors;
	UPROPERTY() TArray<TObjectPtr<ASHProp>> MarkerProps;
	UPROPERTY() TObjectPtr<ASHProp> CheckpointProp;
	UPROPERTY() TObjectPtr<ASHVehicle> MissionCar;
	void StartMission(int32 Index);
	void EndMission(bool bPassed, const FString& Reason);
	void SetCheckpoint(const FVector2D& P, float RadiusM = 6.f);
	void ClearCheckpoint();
	int32 RacePosition() const;

	// map (drawn by the HUD)
	bool bMapOpen = false;

private:
	void BuildWorld();
	void SpawnPlayer(AController* C);
	void UpdateSky(float Dt);
	void UpdateWanted(float Dt);
	void UpdatePopulation(float Dt);
	void UpdatePickups(float Dt);
	void UpdateMissions(float Dt);
	void UpdateZone();
	void SetupMissions();
	ASHVehicle* SpawnTraffic(bool bInCity);
	ASHPed* SpawnPed();
	ASHVehicle* SpawnPoliceCar(ESHVehicleKind Kind);
	float TrafficTimer = 0.f, PedTimer = 0.f, ParkTimer = 0.f, PersistTimer = 0.f;
	UPROPERTY() TArray<TObjectPtr<ASHProp>> CashDrops;
	TArray<int32> CashAmounts;
};
