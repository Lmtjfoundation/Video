// Pedestrians, cops, SWAT and gang members. They walk around their block,
// cross streets, panic at gunfire, and (if armed and angry) shoot back.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "SHHuman.h"
#include "SHPed.generated.h"

enum class ESHPedKind : uint8 { Civ, Cop, Swat, Gang };
enum class ESHPedState : uint8 { Walk, Flee, Attack, Idle, Knocked, Dead };

UCLASS()
class SOUTHERNHEAT_API ASHPed : public ACharacter
{
	GENERATED_BODY()

public:
	ASHPed();
	void Init(ESHPedKind InKind, int32 InBlock, int32 City, const FLinearColor& GangColor);
	virtual void Tick(float DeltaSeconds) override;
	virtual void Landed(const FHitResult& HitResult) override;

	FSHHumanRig Rig;
	ESHPedKind Kind = ESHPedKind::Civ;
	ESHPedState State = ESHPedState::Walk;
	float Health = 50.f;
	int32 Block = -1;
	int32 Corner = 0;
	int32 Dir = 1;
	FVector2D Target;
	float Fear = 0.f;
	FVector FearFrom;
	float ShootCd = 1.f;
	float DeadTimer = 0.f;
	float StuckTime = 0.f;
	bool bHostile = false;
	bool bMissionHostile = false;
	bool bKilledByPlayer = false;
	int32 Cash = 20;

	bool IsAlive() const { return State != ESHPedState::Dead && !(State == ESHPedState::Knocked && Health <= 0.f); }
	void Hit(float Damage, const FVector& HitDir, bool bByPlayer, float Force = 300.f);
	void Knock(const FVector& Velocity);
	void Scare(const FVector& From, float Time);
	void Die();

private:
	FVector2D CornerPos(int32 K) const;
	void CrossStreet();
	float KnockTime = 0.f;
};
