#include "SHPlayerCharacter.h"
#include "SHGameMode.h"
#include "SHWorldBuilder.h"
#include "Components/CapsuleComponent.h"
#include "Components/InputComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Camera/CameraComponent.h"
#include "Engine/World.h"

ASHPlayerCharacter::ASHPlayerCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
	GetCapsuleComponent()->InitCapsuleSize(35.f, 90.f);
	GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Vehicle, ECR_Overlap);
	bUseControllerRotationYaw = false;
	bUseControllerRotationPitch = false;
	bUseControllerRotationRoll = false;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, 720.f, 0.f);
	Move->JumpZVelocity = 680.f;
	Move->AirControl = 0.35f;
	Move->MaxWalkSpeed = 520.f;
	Move->BrakingDecelerationWalking = 2400.f;

	Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("Arm"));
	Arm->SetupAttachment(GetCapsuleComponent());
	Arm->TargetArmLength = 420.f;
	Arm->bUsePawnControlRotation = true;
	Arm->SocketOffset = FVector(0.f, 45.f, 70.f);
	Arm->bEnableCameraLag = true;
	Arm->CameraLagSpeed = 18.f;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Arm);
	Camera->bUsePawnControlRotation = false;
}

void ASHPlayerCharacter::BeginPlay()
{
	Super::BeginPlay();
	if (!bRigBuilt)
	{
		bRigBuilt = true;
		USceneComponent* Feet = NewObject<USceneComponent>(this);
		Feet->SetupAttachment(GetCapsuleComponent());
		Feet->SetRelativeLocation(FVector(0.f, 0.f, -90.f));
		Feet->RegisterComponent();
		AddInstanceComponent(Feet);
		Rig.Build(this, Feet, FSHLook::Player());

		ASHGameMode* GM = ASHGameMode::Get(this);
		Chute = NewObject<USceneComponent>(this);
		Chute->SetupAttachment(GetCapsuleComponent());
		Chute->SetRelativeLocation(FVector(0.f, 0.f, 420.f));
		Chute->RegisterComponent();
		AddInstanceComponent(Chute);
		GM->AddPart(this, Chute, GM->SphereMesh, FVector::ZeroVector, FVector(5.f, 7.f, 1.6f), SH::Hex(TEXT("FF3B3B")));
		GM->AddPart(this, Chute, GM->SphereMesh, FVector(0.f, 0.f, 8.f), FVector(4.f, 5.f, 1.2f), FLinearColor::White);
		for (int32 S = -1; S <= 1; S += 2)
			GM->AddPart(this, Chute, GM->CubeMesh, FVector(0.f, S * 170.f, -170.f), FVector(0.03f, 0.03f, 3.8f), SH::Hex(TEXT("222222")), FRotator(0.f, 0.f, S * 25.f));
		Chute->SetVisibility(false, true);
	}
}

void ASHPlayerCharacter::SetupPlayerInputComponent(UInputComponent* In)
{
	Super::SetupPlayerInputComponent(In);
	In->BindAxis("MoveForward", this, &ASHPlayerCharacter::MoveForward);
	In->BindAxis("MoveRight", this, &ASHPlayerCharacter::MoveRight);
	In->BindAxis("Turn", this, &ASHPlayerCharacter::Turn);
	In->BindAxis("LookUp", this, &ASHPlayerCharacter::LookUp);
	In->BindAction("Jump", IE_Pressed, this, &ASHPlayerCharacter::JumpPressed);
	In->BindAction("Jump", IE_Released, this, &ACharacter::StopJumping);
	In->BindAction("Sprint", IE_Pressed, this, &ASHPlayerCharacter::SprintOn);
	In->BindAction("Sprint", IE_Released, this, &ASHPlayerCharacter::SprintOff);
	In->BindAction("Fire", IE_Pressed, this, &ASHPlayerCharacter::FireOn);
	In->BindAction("Fire", IE_Released, this, &ASHPlayerCharacter::FireOff);
	In->BindAction("Aim", IE_Pressed, this, &ASHPlayerCharacter::AimOn);
	In->BindAction("Aim", IE_Released, this, &ASHPlayerCharacter::AimOff);
	In->BindAction("Enter", IE_Pressed, this, &ASHPlayerCharacter::EnterPressed);
	In->BindAction("NextWeapon", IE_Pressed, this, &ASHPlayerCharacter::NextWeapon);
	In->BindAction("PrevWeapon", IE_Pressed, this, &ASHPlayerCharacter::PrevWeapon);
}

void ASHPlayerCharacter::MoveForward(float V)
{
	if (V == 0.f || !GetController()) return;
	const FRotator Y(0.f, GetControlRotation().Yaw, 0.f);
	AddMovementInput(FRotationMatrix(Y).GetUnitAxis(EAxis::X), V);
}

void ASHPlayerCharacter::MoveRight(float V)
{
	if (V == 0.f || !GetController()) return;
	const FRotator Y(0.f, GetControlRotation().Yaw, 0.f);
	AddMovementInput(FRotationMatrix(Y).GetUnitAxis(EAxis::Y), V);
}

void ASHPlayerCharacter::JumpPressed()
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (GetCharacterMovement()->IsFalling() && !bChuteOpen && GM && GM->World)
	{
		const float Above = GetActorLocation().Z - GM->World->GroundZ(GetActorLocation(), 0.f);
		if (Above > 2000.f) { OpenChute(); return; }
	}
	Jump();
}

void ASHPlayerCharacter::EnterPressed()
{
	if (ASHGameMode* GM = ASHGameMode::Get(this))
	{
		if (GetCharacterMovement()->IsFalling() && !bChuteOpen)
		{
			const float Above = GetActorLocation().Z - GM->World->GroundZ(GetActorLocation(), 0.f);
			if (Above > 2000.f) { OpenChute(); return; }
		}
		GM->TryEnterNearestVehicle();
	}
}

void ASHPlayerCharacter::OpenChute()
{
	bChuteOpen = true;
	Chute->SetVisibility(true, true);
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->GravityScale = 0.12f;
	Move->AirControl = 1.f;
	Move->Velocity.Z = FMath::Max(Move->Velocity.Z, -500.f);
}

void ASHPlayerCharacter::CloseChute()
{
	bChuteOpen = false;
	if (Chute) Chute->SetVisibility(false, true);
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->GravityScale = 1.f;
	Move->AirControl = 0.35f;
}

void ASHPlayerCharacter::Landed(const FHitResult& Hit)
{
	Super::Landed(Hit);
	const float Impact = -GetVelocity().Z / SH::M;
	if (Impact > 15.f && !bChuteOpen) TakeHit((Impact - 15.f) * 9.f, true);
	CloseChute();
}

void ASHPlayerCharacter::Tick(float Dt)
{
	Super::Tick(Dt);
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM || IsHidden() || GM->bPlayerDead) return;
	Cooldown -= Dt;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	const FSHWeaponDef& W = SHWeaponDef(Weapon);
	const float Now = GetWorld()->GetTimeSeconds();
	const bool bAimNow = (bAiming || (bFireHeld && !W.bMelee) || Now - LastShot < 0.6f) && !bSwimming;
	bUseControllerRotationYaw = bAimNow;
	Move->bOrientRotationToMovement = !bAimNow;

	const FVector L = GetActorLocation();
	bSwimming = GM->World && GM->World->IsWater(L.X / SH::M, L.Y / SH::M) && L.Z < 200.f;
	float Speed = bSwimming ? 300.f : bSprinting ? 850.f : 520.f;
	if (GM->bFastRun) Speed *= 1.8f;
	if (bAimNow) Speed = FMath::Min(Speed, 360.f);
	Move->MaxWalkSpeed = Speed;
	Move->JumpZVelocity = GM->bSuperJump ? 2400.f : 680.f;

	// parachute glide
	if (bChuteOpen)
	{
		Move->Velocity.Z = FMath::Max(Move->Velocity.Z, -520.f);
		AddMovementInput(GetActorForwardVector(), 0.6f);
	}
	else if (Move->IsFalling() && GetVelocity().Z < -700.f && GM->World)
	{
		const float Above = L.Z - GM->World->GroundZ(L, 0.f);
		if (Above > 2000.f) GM->ShowHint(TEXT("Press SPACE or F to open your parachute"));
	}

	Arm->TargetArmLength = FMath::FInterpTo(Arm->TargetArmLength, bChuteOpen ? 900.f : bAimNow ? 220.f : 420.f, Dt, 8.f);
	Camera->SetFieldOfView(FMath::FInterpTo(Camera->FieldOfView, bAimNow ? 52.f : 70.f, Dt, 8.f));

	if (bFireHeld) TryFire(false);
	if (PunchT > 0.f)
	{
		PunchT -= Dt;
		Rig.Punch(1.f - PunchT / 0.3f);
	}
	Rig.Animate(Dt, GetVelocity().Size2D(), bAimNow && !W.bMelee, bSwimming);
	if (PunchT > 0.f) Rig.Punch(1.f - PunchT / 0.3f);
	if (Rig.Gun) Rig.Gun->SetVisibility(!W.bMelee);
}

void ASHPlayerCharacter::TryFire(bool bPressed)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM || IsHidden() || GM->bPlayerDead || Cooldown > 0.f || bSwimming) return;
	const FSHWeaponDef& W = SHWeaponDef(Weapon);
	if (!W.bAuto && !bPressed) return;
	Cooldown = W.Rate;
	if (W.bMelee) { Punch(); return; }
	LastShot = GetWorld()->GetTimeSeconds();
	const FVector Muzzle = GetActorLocation() + GetActorForwardVector() * 60.f + GetActorRightVector() * 30.f + FVector(0.f, 0.f, 55.f);
	const FVector Aim = GM->AimPoint(Camera->GetComponentLocation(), Camera->GetForwardVector(), this);
	FireWeapon(Muzzle, Aim, this);
}

void ASHPlayerCharacter::FireWeapon(const FVector& Muzzle, const FVector& Aim, AActor* IgnoreActor)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	const FSHWeaponDef& W = SHWeaponDef(Weapon);
	if (W.bMelee) return;
	int32& A = Ammo[(int32)Weapon];
	if (A <= 0) { CycleWeapon(-1); return; }
	if (!GM->bInfiniteAmmo) --A;
	const FVector Dir = (Aim - Muzzle).GetSafeNormal();
	if (W.bRocket)
	{
		GM->SpawnRocket(Muzzle + Dir * 80.f, Dir, IgnoreActor, true, 7500.f, 9.f);
	}
	else
	{
		for (int32 P = 0; P < W.Pellets; ++P)
		{
			const float S = W.Spread * (bAiming ? 1.f : 1.6f);
			const FVector D = (Dir + FVector(FMath::FRandRange(-S, S), FMath::FRandRange(-S, S), FMath::FRandRange(-S, S))).GetSafeNormal();
			GM->FireBullet(Muzzle, D, W.Damage, W.Range * SH::M, IgnoreActor, true, P == 0 || P % 3 == 0);
		}
	}
	GM->OnPlayerGunfire(Muzzle);
}

void ASHPlayerCharacter::Punch()
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	PunchT = 0.3f;
	GM->PunchFrom(this, GetActorLocation(), GetActorForwardVector());
}

void ASHPlayerCharacter::GiveWeapon(ESHWeapon W, int32 Count)
{
	const FSHWeaponDef& D = SHWeaponDef(W);
	Ammo[(int32)W] = FMath::Min(D.Max, Ammo[(int32)W] + (Count < 0 ? D.Give : Count));
	Weapon = W;
}

void ASHPlayerCharacter::CycleWeapon(int32 Dir)
{
	int32 I = (int32)Weapon;
	for (int32 K = 0; K < (int32)ESHWeapon::Count; ++K)
	{
		I = (I + Dir + (int32)ESHWeapon::Count) % (int32)ESHWeapon::Count;
		if (I == 0 || Ammo[I] > 0) { Weapon = (ESHWeapon)I; return; }
	}
}

void ASHPlayerCharacter::TakeHit(float Damage, bool bFall)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM || GM->bPlayerDead || GM->bGodMode) return;
	if (Armor > 0.f && !bFall)
	{
		const float Absorb = FMath::Min(Armor, Damage * 0.7f);
		Armor -= Absorb;
		Damage -= Absorb;
	}
	Health -= Damage;
	GM->DamageFlash = 0.5f;
	if (Health <= 0.f)
	{
		Health = 0.f;
		GM->PlayerDied();
	}
}

void ASHPlayerCharacter::SetHiddenForVehicle(bool bHide)
{
	SetActorHiddenInGame(bHide);
	SetActorEnableCollision(!bHide);
	if (bHide) GetCharacterMovement()->DisableMovement();
	else GetCharacterMovement()->SetMovementMode(MOVE_Falling);
	CloseChute();
}
