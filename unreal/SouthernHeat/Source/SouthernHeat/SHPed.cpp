#include "SHPed.h"
#include "SHGameMode.h"
#include "SHWorldBuilder.h"
#include "SHPlayerCharacter.h"
#include "AIController.h"
#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"

namespace { constexpr float RING = 38.3f; }

ASHPed::ASHPed()
{
	PrimaryActorTick.bCanEverTick = true;
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
	AIControllerClass = AAIController::StaticClass();
	GetCapsuleComponent()->InitCapsuleSize(35.f, 90.f);
	GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Vehicle, ECR_Overlap);
	GetCapsuleComponent()->SetGenerateOverlapEvents(true);
	bUseControllerRotationYaw = false;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, 540.f, 0.f);
	Move->MaxWalkSpeed = 150.f;
}

void ASHPed::Init(ESHPedKind InKind, int32 InBlock, int32 City, const FLinearColor& GangColor)
{
	Kind = InKind;
	Block = InBlock;
	FSHLook Look;
	switch (Kind)
	{
	case ESHPedKind::Cop: Look = FSHLook::Cop(); Health = 110.f; break;
	case ESHPedKind::Swat: Look = FSHLook::Swat(); Health = 180.f; break;
	case ESHPedKind::Gang: Look = FSHLook::Gang(GangColor); Health = 90.f; break;
	default: Look = FSHLook::Random(City); Health = 50.f; break;
	}
	Cash = Kind == ESHPedKind::Civ ? FMath::RandRange(5, 120) : FMath::RandRange(40, 300);
	USceneComponent* Feet = NewObject<USceneComponent>(this);
	Feet->SetupAttachment(GetCapsuleComponent());
	Feet->SetRelativeLocation(FVector(0.f, 0.f, -90.f));
	Feet->RegisterComponent();
	AddInstanceComponent(Feet);
	Rig.Build(this, Feet, Look);
	Dir = FMath::RandBool() ? 1 : -1;
	Corner = FMath::RandRange(0, 3);
	Target = Block >= 0 ? CornerPos(Corner) : FVector2D(GetActorLocation()) / SH::M;
	ShootCd = FMath::FRandRange(0.5f, 1.5f);
}

FVector2D ASHPed::CornerPos(int32 K) const
{
	const ASHWorldBuilder* W = ASHGameMode::Get(this)->World;
	const FVector2D C = W->Blocks[Block].C;
	static const FVector2D Offs[4] = { FVector2D(-RING, -RING), FVector2D(RING, -RING), FVector2D(RING, RING), FVector2D(-RING, RING) };
	return C + Offs[((K % 4) + 4) % 4] + FVector2D(FMath::FRandRange(-0.6f, 0.6f), FMath::FRandRange(-0.6f, 0.6f));
}

void ASHPed::CrossStreet()
{
	const ASHWorldBuilder* W = ASHGameMode::Get(this)->World;
	const int32 K = ((Corner % 4) + 4) % 4;
	const FVector2D C = W->Blocks[Block].C;
	static const FIntPoint Dirs[4][2] = { { {-1, 0}, {0, -1} }, { {1, 0}, {0, -1} }, { {1, 0}, {0, 1} }, { {-1, 0}, {0, 1} } };
	const FIntPoint D = Dirs[K][FMath::RandRange(0, 1)];
	const FVector2D NC = C + FVector2D(D.X * 100.f, D.Y * 100.f);
	int32 NB = -1;
	for (int32 i = 0; i < W->Blocks.Num(); ++i)
		if (FVector2D::DistSquared(W->Blocks[i].C, NC) < 1.f) { NB = i; break; }
	if (NB < 0) { Target = CornerPos(Corner); return; }
	static const FVector2D Offs[4] = { FVector2D(-RING, -RING), FVector2D(RING, -RING), FVector2D(RING, RING), FVector2D(-RING, RING) };
	const FVector2D CornerP = C + Offs[K];
	const FVector2D T = CornerP + FVector2D(D.X, D.Y) * (100.f - 2.f * RING);
	Block = NB;
	float Best = TNumericLimits<float>::Max();
	for (int32 c = 0; c < 4; ++c)
	{
		const float Dd = FVector2D::DistSquared(W->Blocks[NB].C + Offs[c], T);
		if (Dd < Best) { Best = Dd; Corner = c; }
	}
	Target = T;
}

void ASHPed::Scare(const FVector& From, float Time)
{
	if (!IsAlive() || State == ESHPedState::Knocked) return;
	if (Kind == ESHPedKind::Gang) { bHostile = true; return; }
	if (Kind != ESHPedKind::Civ) return;
	Fear = FMath::Max(Fear, Time);
	FearFrom = From;
	State = ESHPedState::Flee;
}

void ASHPed::Hit(float Damage, const FVector& HitDir, bool bByPlayer, float Force)
{
	if (State == ESHPedState::Dead) return;
	ASHGameMode* GM = ASHGameMode::Get(this);
	Health -= Damage;
	GM->SpawnBlood(GetActorLocation() + FVector(0.f, 0.f, 40.f));
	if (bByPlayer)
	{
		if (Health <= 0.f) bKilledByPlayer = true;
		GM->OnPlayerHurtPed(this, Health <= 0.f);
		if (Kind == ESHPedKind::Gang) bHostile = true;
	}
	if (Health <= 0.f || Force > 600.f) Knock(HitDir.GetSafeNormal2D() * Force + FVector(0.f, 0.f, 250.f + Force * 0.3f));
	else if (Kind == ESHPedKind::Civ) Scare(GetActorLocation() - HitDir * 500.f, 12.f);
}

void ASHPed::Knock(const FVector& Velocity)
{
	if (State == ESHPedState::Dead) return;
	State = ESHPedState::Knocked;
	KnockTime = 0.f;
	LaunchCharacter(Velocity, true, true);
	Rig.LieDown();
}

void ASHPed::Landed(const FHitResult& HitResult)
{
	Super::Landed(HitResult);
	if (State != ESHPedState::Knocked || KnockTime < 0.1f) return;
	if (Health <= 0.f) Die();
	else
	{
		Rig.StandUp();
		State = Kind == ESHPedKind::Civ ? ESHPedState::Flee : ESHPedState::Attack;
		Fear = 8.f;
	}
}

void ASHPed::Die()
{
	if (State == ESHPedState::Dead) return;
	State = ESHPedState::Dead;
	DeadTimer = 0.f;
	Rig.LieDown();
	GetCharacterMovement()->DisableMovement();
	GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	ASHGameMode::Get(this)->OnPedKilled(this, bKilledByPlayer);
}

void ASHPed::Tick(float Dt)
{
	Super::Tick(Dt);
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM || !GM->World) return;
	if (State == ESHPedState::Dead) { DeadTimer += Dt; return; }
	if (State == ESHPedState::Knocked)
	{
		KnockTime += Dt;
		if (KnockTime > 3.f && !GetCharacterMovement()->IsFalling())
		{
			if (Health <= 0.f) Die();
			else { Rig.StandUp(); State = ESHPedState::Flee; Fear = 8.f; }
		}
		return;
	}

	const FVector L = GetActorLocation();
	const FVector PP = GM->PlayerPos();
	const float DP = FVector::Dist2D(L, PP) / SH::M;
	const bool bLaw = Kind == ESHPedKind::Cop || Kind == ESHPedKind::Swat;
	if (bLaw && GM->WantedLevel > 0) State = ESHPedState::Attack;
	if (Kind == ESHPedKind::Gang && bHostile && !GM->bPlayerDead) State = ESHPedState::Attack;
	if (bLaw && GM->WantedLevel == 0 && State == ESHPedState::Attack) State = Block >= 0 ? ESHPedState::Walk : ESHPedState::Idle;

	FVector2D Goal = Target;
	float Speed = 150.f;
	bool bAimingNow = false;
	switch (State)
	{
	case ESHPedState::Flee:
	{
		Fear -= Dt;
		const FVector Away = (L - FearFrom).GetSafeNormal2D();
		Goal = FVector2D(L.X, L.Y) / SH::M + FVector2D(Away.X, Away.Y) * 10.f;
		Speed = 520.f;
		if (Fear <= 0.f) { State = ESHPedState::Walk; if (Block >= 0) Target = CornerPos(Corner); }
		break;
	}
	case ESHPedState::Attack:
	{
		Goal = FVector2D(PP.X, PP.Y) / SH::M;
		Speed = 420.f;
		const float Range = Kind == ESHPedKind::Swat ? 18.f : 14.f;
		const bool bCanSee = DP < 55.f && !GM->bPlayerDead;
		if (DP < Range && bCanSee) Speed = 0.f;
		if (bCanSee)
		{
			bAimingNow = true;
			ShootCd -= Dt;
			if (ShootCd <= 0.f)
			{
				ShootCd = Kind == ESHPedKind::Swat ? FMath::FRandRange(0.25f, 0.5f) : FMath::FRandRange(0.7f, 1.4f);
				const FVector From = L + GetActorForwardVector() * 50.f + FVector(0.f, 0.f, 55.f);
				if (GM->World->LineOfSight(From, PP + FVector(0.f, 0.f, 60.f), this, GM->PlayerVehicle))
					GM->NpcShoot(From, Kind == ESHPedKind::Swat ? 0.6f : Kind == ESHPedKind::Cop ? 0.45f : 0.35f, Kind == ESHPedKind::Swat ? 9.f : 7.f, this);
			}
			const FVector ToP = (PP - L).GetSafeNormal2D();
			SetActorRotation(FMath::RInterpTo(GetActorRotation(), ToP.Rotation(), Dt, 10.f));
		}
		if (Kind == ESHPedKind::Cop && DP < 2.2f && GM->WantedLevel <= 2 && !GM->PlayerVehicle) GM->TryBust(Dt);
		if (DP > 150.f) State = ESHPedState::Idle;
		break;
	}
	case ESHPedState::Idle:
		Speed = 0.f;
		break;
	default:
		if (Block >= 0 && FVector2D::Distance(FVector2D(L.X, L.Y) / SH::M, Target) < 1.2f)
		{
			Corner += Dir;
			if (FMath::FRand() < 0.2f) CrossStreet();
			else Target = CornerPos(Corner);
		}
		Goal = Target;
		break;
	}

	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->MaxWalkSpeed = FMath::Max(Speed, 1.f);
	Move->bOrientRotationToMovement = !bAimingNow;
	const FVector ToGoal(Goal.X * SH::M - L.X, Goal.Y * SH::M - L.Y, 0.f);
	if (Speed > 0.f && ToGoal.Size2D() > 40.f)
	{
		AddMovementInput(ToGoal.GetSafeNormal(), 1.f);
		if (GetVelocity().Size2D() < 30.f)
		{
			StuckTime += Dt;
			if (StuckTime > 1.5f && State == ESHPedState::Walk && Block >= 0) { Dir = -Dir; Corner += Dir; Target = CornerPos(Corner); StuckTime = 0.f; }
		}
		else StuckTime = 0.f;
	}
	Rig.Animate(Dt, GetVelocity().Size2D(), bAimingNow);
	if (Rig.Gun) Rig.Gun->SetVisibility(bAimingNow || bLaw);
}
