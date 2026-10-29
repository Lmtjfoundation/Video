// Arcade vehicle pawn: cars, bikes, monster truck, tank and helicopters.
// Driven by the player (possessed) or by the built-in AI (traffic / police / race).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "SHTypes.h"
#include "SHVehicle.generated.h"

class UBoxComponent;
class USpringArmComponent;
class UCameraComponent;
class UStaticMeshComponent;
class UPointLightComponent;

enum class ESHDriveMode : uint8 { None, Parked, Traffic, Chase, Race, HeliPatrol };

UCLASS()
class SOUTHERNHEAT_API ASHVehicle : public APawn
{
	GENERATED_BODY()

public:
	ASHVehicle();
	void Init(ESHVehicleKind InKind, const FLinearColor& Paint);
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	UPROPERTY(VisibleAnywhere) TObjectPtr<UBoxComponent> Box;
	UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> Body;
	UPROPERTY(VisibleAnywhere) TObjectPtr<USpringArmComponent> Arm;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> Camera;
	UPROPERTY() TArray<TObjectPtr<USceneComponent>> Wheels;
	UPROPERTY() TArray<TObjectPtr<USceneComponent>> SteerWheels;
	UPROPERTY() TObjectPtr<USceneComponent> Rotor;
	UPROPERTY() TObjectPtr<USceneComponent> Turret;
	UPROPERTY() TObjectPtr<UPointLightComponent> SirenRed;
	UPROPERTY() TObjectPtr<UPointLightComponent> SirenBlue;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> FireFx;
	UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> PaintParts;

	ESHVehicleKind Kind = ESHVehicleKind::Sedan;
	const FSHVehicleDef* Def = nullptr;
	FLinearColor PaintColor;

	// physics state (cm, cm/s)
	FVector Vel = FVector::ZeroVector;
	float VelZ = 0.f;
	float Yaw = 0.f;      // degrees, Unreal convention
	float YawRate = 0.f;
	bool bGrounded = true;
	float AirTime = 0.f, MaxAir = 0.f;
	float RotorSpeed = 0.f;
	float Health = 1000.f;
	float MaxHealth = 1000.f;
	bool bDead = false, bOnFire = false, bSunk = false, bCrushed = false;
	float WreckTimer = 0.f;
	bool bSiren = false;
	bool bLastHitByPlayer = false;
	bool bPersistent = false;
	bool bMissionVehicle = false;
	int32 ParkSpot = -1;
	int32 SpecialSpot = -1;
	float TurretYaw = 0.f;

	// inputs (-1..1)
	float Throttle = 0.f, Steer = 0.f, Lift = 0.f;
	bool bHandbrake = false, bNitro = false, bFiring = false;
	float FireCooldown = 0.f;
	float CamIdle = 0.f;

	// driver
	bool bPlayerDriven = false;
	ESHDriveMode Mode = ESHDriveMode::None;
	int32 EdgeId = -1, FromNode = -1, ToNode = -1, NextEdge = -1;
	float Lane = 4.5f;
	float Panic = 0.f, Stuck = 0.f, Reverse = 0.f, ShootCd = 1.f, Skill = 1.f, Rubber = 1.f;
	int32 StuckCount = 0;
	bool bCopsOut = false;
	bool bSwat = false;
	TArray<int32> Path;
	int32 PathIdx = 0;
	float Repath = 0.f;
	TArray<FVector2D> RaceCheckpoints;
	int32 RaceIdx = 0;
	float Orbit = 0.f;

	float SpeedMs() const { return Vel.Size2D() / 100.f; }
	float ForwardSpeed() const;   // cm/s
	FVector Forward() const;
	void PlaceOnEdge(int32 InEdge, int32 InFrom, float T);
	bool AttachToRoad();
	void Damage(float Amount, bool bByPlayer, bool bExplosion = false);
	void Explode();
	void Crush(ASHVehicle* By);
	FVector DoorPoint() const;

	// input handlers
	void InThrottle(float V) { Throttle = V; }
	void InSteer(float V) { Steer = V; }
	void InLift(float V) { Lift = V; }
	void InTurn(float V);
	void InLookUp(float V);
	void HandbrakeOn() { bHandbrake = true; }
	void HandbrakeOff() { bHandbrake = false; }
	void NitroOn() { bNitro = true; }
	void NitroOff() { bNitro = false; }
	void FireOn() { bFiring = true; }
	void FireOff() { bFiring = false; }
	void HornPressed();
	void ExitPressed();

private:
	void BuildModel();
	void TickCar(float Dt);
	void TickHeli(float Dt);
	void TickAI(float Dt);
	void AITraffic(float Dt, FVector2D& Target, float& Desired);
	void AIChase(float Dt, FVector2D& Target, float& Desired);
	void AIRace(float Dt, FVector2D& Target, float& Desired);
	void AIHeli(float Dt);
	void DriveToward(const FVector2D& Target, float DesiredMs, float Dt);
	float ObstacleLimit(float Desired) const;
	FVector2D LanePoint(int32 E, int32 From, float S, float InLane) const;
	void ChooseNext();
	void HandlePlayerWeapons(float Dt);
	void UpdateVisuals(float Dt);
	float GroundBelow(const FVector& P) const;
	float HalfHeight = 60.f;
	float Clearance = 35.f;
	float PitchVis = 0.f, RollVis = 0.f, SteerVis = 0.f, WheelSpin = 0.f;
	float SirenTime = 0.f;
};
