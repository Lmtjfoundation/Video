#include "SHVehicle.h"
#include "SHGameMode.h"
#include "SHWorldBuilder.h"
#include "SHPlayerCharacter.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/InputComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "GameFramework/PlayerController.h"
#include "Camera/CameraComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Materials/MaterialInstanceDynamic.h"

ASHVehicle::ASHVehicle()
{
	PrimaryActorTick.bCanEverTick = true;
	AutoPossessAI = EAutoPossessAI::Disabled;

	Box = CreateDefaultSubobject<UBoxComponent>(TEXT("Box"));
	SetRootComponent(Box);
	Box->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Box->SetCollisionObjectType(ECC_Vehicle);
	Box->SetCollisionResponseToAllChannels(ECR_Block);
	Box->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
	Box->SetCollisionResponseToChannel(ECC_Camera, ECR_Ignore);
	Box->SetGenerateOverlapEvents(true);

	Body = CreateDefaultSubobject<USceneComponent>(TEXT("Body"));
	Body->SetupAttachment(Box);

	Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("Arm"));
	Arm->SetupAttachment(Box);
	Arm->bUsePawnControlRotation = true;
	Arm->bInheritRoll = false;
	Arm->bEnableCameraLag = true;
	Arm->CameraLagSpeed = 10.f;
	Arm->TargetArmLength = 900.f;
	Arm->SocketOffset = FVector(0.f, 0.f, 180.f);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Arm);
	Camera->FieldOfView = 75.f;
}

void ASHVehicle::Init(ESHVehicleKind InKind, const FLinearColor& Paint)
{
	Kind = InKind;
	Def = &SHVehicleDef(Kind);
	PaintColor = Paint;
	MaxHealth = Health = Def->HP;
	Yaw = GetActorRotation().Yaw;
	TurretYaw = Yaw;
	const float HgtCm = Def->Hgt * SH::M;
	Clearance = Def->bHeli ? 20.f : FMath::Min(40.f, HgtCm * 0.25f);
	HalfHeight = (HgtCm - Clearance) * 0.5f;
	Box->SetBoxExtent(FVector(Def->Len * 50.f, Def->Wid * 50.f, HalfHeight));
	Body->SetRelativeLocation(FVector(0.f, 0.f, -(Clearance + HalfHeight)));
	Arm->TargetArmLength = Def->bHeli ? 1600.f : (Def->Len * 120.f + 400.f);
	if (Kind == ESHVehicleKind::Bike) Arm->TargetArmLength = 520.f;
	BuildModel();
	// snap to ground
	const float G = GroundBelow(GetActorLocation());
	SetActorLocation(FVector(GetActorLocation().X, GetActorLocation().Y, FMath::Max(G, GetActorLocation().Z - Clearance - HalfHeight) + Clearance + HalfHeight));
}

FVector ASHVehicle::Forward() const
{
	const float R = FMath::DegreesToRadians(Yaw);
	return FVector(FMath::Cos(R), FMath::Sin(R), 0.f);
}

float ASHVehicle::ForwardSpeed() const { return FVector::DotProduct(Vel, Forward()); }

FVector ASHVehicle::DoorPoint() const
{
	const FVector F = Forward();
	const FVector Left(F.Y, -F.X, 0.f);
	return GetActorLocation() + Left * (Def->Wid * 50.f + 90.f);
}

float ASHVehicle::GroundBelow(const FVector& P) const
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM || !GM->World) return 0.f;
	return GM->World->GroundZ(FVector(P.X, P.Y, P.Z - HalfHeight - Clearance), 150.f);
}

// ------------------------------------------------------------------- model
void ASHVehicle::BuildModel()
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	GM->EnsureAssets();
	const float L = Def->Len, W = Def->Wid;
	const FLinearColor Glass = SH::Hex(TEXT("1B2633")), Black = SH::Hex(TEXT("161616")), Chrome = SH::Hex(TEXT("C8C8C8"));
	const FLinearColor Head = SH::Hex(TEXT("FFF6D8")), Tail = SH::Hex(TEXT("FF2A2A"));
	// part helper: centre (x fwd, y right, z up) and size in metres
	auto P = [&](float X, float Y, float Z, float SX, float SY, float SZ, const FLinearColor& C, bool bPaint = false, UStaticMesh* Mesh = nullptr, USceneComponent* Parent = nullptr, FRotator Rot = FRotator::ZeroRotator)
	{
		UStaticMeshComponent* Part = GM->AddPart(this, Parent ? Parent : Body.Get(), Mesh ? Mesh : GM->CubeMesh.Get(), FVector(X, Y, Z) * SH::M, FVector(SX, SY, SZ), C, Rot);
		if (bPaint) PaintParts.Add(Part);
		return Part;
	};
	auto Wheel = [&](float X, float Y, float R, float WW, bool bSteer)
	{
		USceneComponent* Pivot = NewObject<USceneComponent>(this);
		Pivot->SetupAttachment(Body);
		Pivot->SetRelativeLocation(FVector(X, Y, R) * SH::M);
		Pivot->RegisterComponent();
		AddInstanceComponent(Pivot);
		USceneComponent* Spin = NewObject<USceneComponent>(this);
		Spin->SetupAttachment(Pivot);
		Spin->RegisterComponent();
		AddInstanceComponent(Spin);
		P(0, 0, 0, R * 2, R * 2, WW, Black, false, GM->CylinderMesh, Spin, FRotator(0.f, 0.f, 90.f));
		P(0, 0, 0, R * 1.2f, R * 1.2f, WW + 0.02f, Chrome, false, GM->CylinderMesh, Spin, FRotator(0.f, 0.f, 90.f));
		Wheels.Add(Spin);
		if (bSteer) SteerWheels.Add(Pivot);
	};
	auto Lamps = [&](float Z, float Y)
	{
		P(L * 0.5f + 0.02f, -Y, Z, 0.08f, 0.45f, 0.18f, Head);
		P(L * 0.5f + 0.02f, Y, Z, 0.08f, 0.45f, 0.18f, Head);
		P(-L * 0.5f - 0.02f, -Y, Z, 0.08f, 0.45f, 0.18f, Tail);
		P(-L * 0.5f - 0.02f, Y, Z, 0.08f, 0.45f, 0.18f, Tail);
	};
	auto FourWheels = [&](float R, float WW, float Inset)
	{
		for (int32 SY = -1; SY <= 1; SY += 2)
		{
			Wheel(L * 0.32f, SY * (W * 0.5f - Inset), R, WW, true);
			Wheel(-L * 0.3f, SY * (W * 0.5f - Inset), R, WW, false);
		}
	};

	switch (Kind)
	{
	case ESHVehicleKind::Sedan: case ESHVehicleKind::Police: case ESHVehicleKind::Taxi:
		P(0, 0, 0.61f, L, W, 0.62f, PaintColor, true);
		P(-0.2f, 0, 1.18f, L * 0.46f, W * 0.86f, 0.52f, Glass);
		P(-0.25f, 0, 1.48f, L * 0.38f, W * 0.84f, 0.08f, PaintColor, true);
		P(L * 0.5f + 0.05f, 0, 0.45f, 0.12f, W * 0.9f, 0.28f, Black);
		Lamps(0.72f, W * 0.5f - 0.35f);
		if (Kind == ESHVehicleKind::Police)
		{
			P(0.2f, 0, 0.67f, L * 0.52f, W + 0.02f, 0.45f, SH::Hex(TEXT("F4F4F4")));
			P(-0.25f, -0.38f, 1.6f, 0.3f, 0.6f, 0.18f, SH::Hex(TEXT("FF1A1A")));
			P(-0.25f, 0.38f, 1.6f, 0.3f, 0.6f, 0.18f, SH::Hex(TEXT("1A4DFF")));
			SirenRed = NewObject<UPointLightComponent>(this);
			SirenRed->SetupAttachment(Body);
			SirenRed->SetRelativeLocation(FVector(-25.f, -40.f, 190.f));
			SirenRed->SetLightColor(FLinearColor::Red);
			SirenRed->SetIntensity(0.f);
			SirenRed->SetAttenuationRadius(1200.f);
			SirenRed->SetCastShadows(false);
			SirenRed->RegisterComponent();
			AddInstanceComponent(SirenRed);
			SirenBlue = NewObject<UPointLightComponent>(this);
			SirenBlue->SetupAttachment(Body);
			SirenBlue->SetRelativeLocation(FVector(-25.f, 40.f, 190.f));
			SirenBlue->SetLightColor(FLinearColor(0.1f, 0.3f, 1.f));
			SirenBlue->SetIntensity(0.f);
			SirenBlue->SetAttenuationRadius(1200.f);
			SirenBlue->SetCastShadows(false);
			SirenBlue->RegisterComponent();
			AddInstanceComponent(SirenBlue);
		}
		if (Kind == ESHVehicleKind::Taxi) P(-0.25f, 0, 1.65f, 0.35f, 0.9f, 0.3f, SH::Hex(TEXT("FFF3A0")));
		FourWheels(Def->WheelR, 0.28f, 0.12f);
		break;
	case ESHVehicleKind::Sports:
		P(0, 0, 0.47f, L, W, 0.5f, PaintColor, true);
		P(L * 0.25f, 0, 0.76f, L * 0.4f, W * 0.9f, 0.08f, PaintColor, true);
		P(-0.35f, 0, 0.91f, L * 0.34f, W * 0.8f, 0.38f, Glass);
		P(-L * 0.5f + 0.2f, 0, 1.03f, 0.4f, W * 0.95f, 0.06f, Black);
		Lamps(0.56f, W * 0.5f - 0.4f);
		FourWheels(Def->WheelR, 0.34f, 0.12f);
		break;
	case ESHVehicleKind::Muscle:
		P(0, 0, 0.61f, L, W, 0.62f, PaintColor, true);
		P(-0.35f, 0, 1.13f, L * 0.38f, W * 0.84f, 0.42f, Glass);
		P(-0.4f, 0, 1.37f, L * 0.3f, W * 0.82f, 0.07f, PaintColor, true);
		P(0.8f, -0.25f, 0.93f, L * 0.45f, 0.22f, 0.01f, FLinearColor::White);
		P(0.8f, 0.25f, 0.93f, L * 0.45f, 0.22f, 0.01f, FLinearColor::White);
		P(L * 0.22f, 0, 1.03f, 0.9f, 0.7f, 0.22f, Black);
		Lamps(0.72f, W * 0.5f - 0.35f);
		FourWheels(Def->WheelR, 0.36f, 0.12f);
		break;
	case ESHVehicleKind::Pickup: case ESHVehicleKind::Monster:
	{
		const float LiftH = Kind == ESHVehicleKind::Monster ? 1.5f : 0.f;
		P(0.2f, 0, 0.83f + LiftH, L - 0.4f, W, 0.75f, PaintColor, true);
		P(0.55f, 0, 1.5f + LiftH, L * 0.3f, W * 0.94f, 0.6f, PaintColor, true);
		P(0.55f, 0, 1.52f + LiftH, L * 0.31f, W * 0.95f, 0.46f, Glass);
		P(-L * 0.28f, 0, 1.24f + LiftH, L * 0.38f, W * 0.9f, 0.08f, SH::Hex(TEXT("2A2A2A")));
		P(L * 0.5f + 0.02f, 0, 0.7f + LiftH, 0.15f, W, 0.5f, Chrome);
		Lamps(0.95f + LiftH, W * 0.5f - 0.35f);
		if (Kind == ESHVehicleKind::Monster)
		{
			P(0, 0, 1.4f, L * 0.8f, 1.2f, 0.8f, SH::Hex(TEXT("333333")));
			for (int32 SY = -1; SY <= 1; SY += 2)
			{
				Wheel(L * 0.34f, SY * (W * 0.5f + 0.2f), Def->WheelR, 0.9f, true);
				Wheel(-L * 0.34f, SY * (W * 0.5f + 0.2f), Def->WheelR, 0.9f, false);
			}
		}
		else FourWheels(Def->WheelR, 0.32f, 0.14f);
		break;
	}
	case ESHVehicleKind::Van:
		P(0, 0, 1.35f, L, W, 2.0f, PaintColor, true);
		P(L * 0.5f - 0.25f, 0, 1.7f, 0.55f, W * 0.92f, 0.7f, Glass);
		Lamps(0.75f, W * 0.5f - 0.35f);
		FourWheels(Def->WheelR, 0.3f, 0.14f);
		break;
	case ESHVehicleKind::Bus:
		P(0, 0, 1.8f, L, W, 2.8f, PaintColor, true);
		P(-0.2f, 0, 2.2f, L * 0.8f, W + 0.02f, 1.f, Glass);
		P(L * 0.5f, 0, 2.1f, 0.04f, W * 0.9f, 1.6f, Glass);
		Lamps(0.7f, W * 0.5f - 0.35f);
		FourWheels(Def->WheelR, 0.4f, 0.2f);
		break;
	case ESHVehicleKind::Bike:
		P(0.1f, 0, 0.77f, 1.3f, 0.45f, 0.45f, PaintColor, true);
		P(0.55f, 0, 0.93f, 0.5f, 0.5f, 0.3f, PaintColor, true);
		P(-0.35f, 0, 0.96f, 0.8f, 0.35f, 0.12f, Black);
		P(0.75f, 0, 1.08f, 0.06f, 0.8f, 0.06f, Chrome);
		Wheel(0.85f, 0, Def->WheelR, 0.16f, true);
		Wheel(-0.75f, 0, Def->WheelR, 0.16f, false);
		break;
	case ESHVehicleKind::Tank:
	{
		P(0, 0, 1.1f, L, W * 0.78f, 1.f, PaintColor, true);
		P(0.2f, 0, 1.85f, L * 0.85f, W * 0.95f, 0.5f, PaintColor, true);
		P(0, -W * 0.5f + 0.4f, 0.65f, L * 1.02f, 0.8f, 1.3f, SH::Hex(TEXT("1C1C1C")));
		P(0, W * 0.5f - 0.4f, 0.65f, L * 1.02f, 0.8f, 1.3f, SH::Hex(TEXT("1C1C1C")));
		Turret = NewObject<USceneComponent>(this);
		Turret->SetupAttachment(Body);
		Turret->SetRelativeLocation(FVector(-20.f, 0.f, 210.f));
		Turret->RegisterComponent();
		AddInstanceComponent(Turret);
		P(0, 0, 0.45f, 3.4f, 2.8f, 0.9f, PaintColor, true, nullptr, Turret);
		P(3.9f, 0, 0.55f, 0.35f, 0.35f, 5.f, PaintColor, true, GM->CylinderMesh, Turret, FRotator(90.f, 0.f, 0.f));
		for (float X = -2.8f; X <= 2.9f; X += 1.4f)
			for (int32 SY = -1; SY <= 1; SY += 2) Wheel(X, SY * (W * 0.5f - 0.4f), 0.45f, 0.3f, false);
		break;
	}
	case ESHVehicleKind::Heli: case ESHVehicleKind::PoliceHeli:
	{
		P(0.5f, 0, 1.8f, 4.2f, 2.2f, 2.f, PaintColor, true);
		P(2.3f, 0, 2.2f, 1.f, 2.f, 1.4f, Glass);
		P(-3.3f, 0, 2.5f, 5.f, 0.5f, 0.5f, PaintColor, true);
		P(-5.6f, 0, 2.6f, 0.9f, 0.15f, 1.6f, PaintColor, true);
		P(0.4f, -0.9f, 0.06f, 4.2f, 0.12f, 0.12f, SH::Hex(TEXT("444444")));
		P(0.4f, 0.9f, 0.06f, 4.2f, 0.12f, 0.12f, SH::Hex(TEXT("444444")));
		for (int32 SY = -1; SY <= 1; SY += 2) for (int32 SX = -1; SX <= 1; SX += 2) P(0.3f + SX * 0.9f, SY * 0.9f, 0.45f, 0.08f, 0.08f, 0.7f, SH::Hex(TEXT("444444")));
		if (Kind == ESHVehicleKind::PoliceHeli) P(0.5f, 0, 2.f, 4.f, 2.22f, 0.3f, SH::Hex(TEXT("F4F4F4")));
		else { P(0.8f, -1.35f, 1.9f, 1.6f, 0.35f, 0.35f, SH::Hex(TEXT("333333"))); P(0.8f, 1.35f, 1.9f, 1.6f, 0.35f, 0.35f, SH::Hex(TEXT("333333"))); }
		Rotor = NewObject<USceneComponent>(this);
		Rotor->SetupAttachment(Body);
		Rotor->SetRelativeLocation(FVector(30.f, 0.f, 310.f));
		Rotor->RegisterComponent();
		AddInstanceComponent(Rotor);
		P(0, 0, 0, 11.f, 0.35f, 0.06f, SH::Hex(TEXT("222222")), false, nullptr, Rotor);
		P(0, 0, 0, 0.35f, 11.f, 0.06f, SH::Hex(TEXT("222222")), false, nullptr, Rotor);
		break;
	}
	default: break;
	}
	FireFx = P(L * 0.35f, 0, Def->Hgt * 0.9f, 0.9f, 0.9f, 1.2f, SH::Hex(TEXT("FF7A1A")), false, GM->SphereMesh);
	FireFx->SetVisibility(false);
}

// -------------------------------------------------------------------- tick
void ASHVehicle::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!Def) return;
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!bPlayerDriven && Mode != ESHDriveMode::None && Mode != ESHDriveMode::Parked && !bDead) TickAI(Dt);
	if (bPlayerDriven) HandlePlayerWeapons(Dt);
	if (Def->bHeli) TickHeli(Dt); else TickCar(Dt);

	if (bOnFire)
	{
		if (!bDead)
		{
			Health -= MaxHealth * 0.03f * Dt;
			if (Health <= 0.f) Explode();
		}
		FireFx->SetVisibility(WreckTimer < 25.f);
		FireFx->SetRelativeScale3D(FVector(0.9f, 0.9f, 1.2f) * FMath::FRandRange(0.8f, 1.4f));
	}
	if (bDead) WreckTimer += Dt;

	// run over pedestrians
	if (SpeedMs() > 3.5f && GM) GM->RunOver(this);
	UpdateVisuals(Dt);
}

void ASHVehicle::TickCar(float Dt)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	const bool bControl = (bPlayerDriven || Mode != ESHDriveMode::None) && !bDead && !bSunk;
	const float Thr = bControl ? Throttle : 0.f;
	const float St = bControl ? Steer : 0.f;
	const bool bHB = bControl ? bHandbrake : true;
	const bool bNos = bControl && bPlayerDriven && bNitro && GM->Nitro > 0.f;

	FVector F = Forward();
	FVector R(-F.Y, F.X, 0.f);
	float Vf = FVector::DotProduct(Vel, F);
	float Vl = FVector::DotProduct(Vel, R);
	const float Turbo = (bPlayerDriven && GM->bFastCars) ? 1.5f : 1.f;

	if (bGrounded)
	{
		const float Max = Def->MaxSpeed * SH::M * (bNos ? 1.35f : 1.f) * Turbo;
		if (Thr > 0.f)
		{
			if (Vf < -50.f) Vf += Def->Brake * SH::M * Thr * Dt;
			else
			{
				const float Ratio = FMath::Clamp(Vf / Max, 0.f, 1.2f);
				Vf += Def->Accel * SH::M * Thr * (1.f - Ratio * Ratio) * Dt * Turbo;
			}
		}
		else if (Thr < 0.f)
		{
			if (Vf > 50.f) Vf += Def->Brake * SH::M * Thr * Dt;
			else if (Vf > -Def->MaxSpeed * SH::M * 0.3f) Vf += Def->Accel * SH::M * 0.6f * Thr * Dt;
		}
		else
		{
			const float Roll = 300.f * Dt;
			Vf = FMath::Abs(Vf) < Roll ? 0.f : Vf - FMath::Sign(Vf) * Roll;
		}
		if (bNos)
		{
			Vf += 2200.f * Dt;
			GM->Nitro = FMath::Max(0.f, GM->Nitro - Dt * 0.28f);
		}
		if (Vf > Max * 1.02f) Vf -= (Vf - Max) * 2.f * Dt;

		const float Spd = FMath::Abs(Vf) / SH::M;
		const float SpeedFactor = FMath::Clamp(Spd / 4.f, 0.f, 1.f);
		const float Rate = Def->Steer * 2.1f / (1.f + Spd * 0.028f);
		float YawRad = St * Rate * SpeedFactor * (Vf >= 0.f ? 1.f : -1.f);
		if (bHB) YawRad *= 1.45f;
		YawRate = FMath::RadiansToDegrees(YawRad);
		Yaw += YawRate * Dt;
		const float Grip = bHB ? 1.2f : Def->Grip;
		Vl *= FMath::Exp(-Grip * Dt);
		if (bHB) Vf = FMath::Abs(Vf) < 700.f * Dt ? 0.f : Vf - FMath::Sign(Vf) * 700.f * Dt;
		F = Forward();
		R = FVector(-F.Y, F.X, 0.f);
		Vel = F * Vf + R * Vl;
	}
	else
	{
		VelZ -= 2400.f * Dt;
		Yaw += St * 45.f * Dt;
	}

	// integrate with a swept move
	const FVector Old = GetActorLocation();
	FVector New = Old + Vel * Dt;
	const float OldBottom = Old.Z - HalfHeight - Clearance;
	const float G = GroundBelow(FVector(New.X, New.Y, Old.Z));
	float Bottom;
	if (bGrounded)
	{
		if (G >= OldBottom - 40.f)
		{
			VelZ = FMath::Clamp(Dt > 0.f ? (G - OldBottom) / Dt : 0.f, -800.f, 4000.f);
			Bottom = G;
			AirTime = 0.f;
		}
		else
		{
			bGrounded = false;
			MaxAir = 0.f;
			Bottom = OldBottom + VelZ * Dt;
		}
	}
	else
	{
		Bottom = OldBottom + VelZ * Dt;
		AirTime += Dt;
		MaxAir = FMath::Max(MaxAir, (Bottom - G) / SH::M);
		if (Bottom <= G)
		{
			const float Impact = -VelZ / SH::M;
			Bottom = G;
			if (Kind == ESHVehicleKind::Monster && Impact > 6.f) VelZ = Impact * 0.35f * SH::M;
			else { VelZ = 0.f; bGrounded = true; }
			if (Impact > 20.f && !(bPlayerDriven && GM->bGodMode)) Damage((Impact - 20.f) * 15.f / FMath::Sqrt(Def->Mass), false);
			if (bPlayerDriven) GM->OnPlayerLanded(this, Impact);
		}
	}
	// water
	if (GM->World->IsWater(New.X / SH::M, New.Y / SH::M) && Bottom < 30.f)
	{
		if (!bSunk)
		{
			bSunk = true;
			GM->OnVehicleSunk(this);
		}
		Vel *= FMath::Exp(-2.f * Dt);
		Bottom = FMath::Max(Bottom - 60.f * Dt, -140.f);
	}
	New.Z = Bottom + Clearance + HalfHeight;
	SetActorRotation(FRotator(0.f, Yaw, 0.f));
	FHitResult Hit;
	SetActorLocation(New, true, &Hit);
	if (Hit.bBlockingHit)
	{
		FVector N = Hit.ImpactNormal; N.Z = 0.f;
		if (!N.Normalize()) N = -F;
		ASHVehicle* Other = Cast<ASHVehicle>(Hit.GetActor());
		if (Other && !Other->Def) Other = nullptr;
		if (Other)
		{
			const FVector Rel = Vel - Other->Vel;
			const float Approach = -FVector::DotProduct(Rel, N);
			if (Def->bCrusher && !Other->Def->bCrusher && !Other->Def->bHeli && Rel.Size2D() > 300.f) Other->Crush(this);
			else if (Other->Def->bCrusher && !Def->bCrusher && Rel.Size2D() > 300.f) Crush(Other);
			else if (Approach > 0.f)
			{
				const float Ia = 1.f / (Def->Mass * (bDead ? 1.5f : 1.f)), Ib = 1.f / (Other->Def->Mass * (Other->bDead ? 1.5f : 1.f));
				const float J = 1.25f * Approach / (Ia + Ib);
				Vel += N * J * Ia;
				Other->Vel -= N * J * Ib;
				if (Approach > 500.f)
				{
					const float Dmg = FMath::Min(700.f, (Approach / SH::M - 5.f) * 20.f);
					Damage(Dmg * Ia / (Ia + Ib) * 1.4f, Other->bPlayerDriven);
					Other->Damage(Dmg * Ib / (Ia + Ib) * 1.4f, bPlayerDriven);
					GM->OnVehicleCollision(this, Other, Approach / SH::M);
				}
			}
		}
		else
		{
			const float Vn = FVector::DotProduct(Vel, N);
			if (Vn < 0.f)
			{
				Vel -= N * Vn * 1.25f;
				Vel *= 0.92f;
				const float Impact = -Vn / SH::M;
				if (Impact > 7.f)
				{
					Damage(FMath::Min(MaxHealth * 0.3f, (Impact - 7.f) * 11.f / FMath::Sqrt(Def->Mass)) * (Def->bCrusher ? 0.3f : 1.f), false);
					GM->OnVehicleCrash(this, Impact, Hit.ImpactPoint);
				}
			}
		}
	}
}

void ASHVehicle::TickHeli(float Dt)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	const bool bDriven = (bPlayerDriven || Mode == ESHDriveMode::HeliPatrol) && !bDead;
	RotorSpeed = FMath::FInterpTo(RotorSpeed, bDriven ? 1.f : 0.f, Dt, bDriven ? 0.8f : 0.3f);
	const bool bPower = RotorSpeed > 0.75f;
	const FVector F = Forward();
	const float Thrust = Def->Accel * SH::M * ((bPlayerDriven && GM->bFastCars) ? 1.6f : 1.f);
	const float PitchIn = bDriven ? Throttle : 0.f;
	if (bPower)
	{
		Vel += F * PitchIn * Thrust * Dt;
		VelZ += ((bDriven ? Lift : 0.f) * 1600.f - VelZ * 1.8f) * Dt;
	}
	else VelZ -= 1800.f * Dt;
	Vel *= FMath::Exp(-0.7f * Dt);
	const float YawIn = bDead ? 240.f : (bDriven ? Steer * 90.f : 0.f);
	YawRate = YawIn;
	Yaw += YawIn * Dt * (bPower || bDead ? 1.f : 0.f);

	const FVector Old = GetActorLocation();
	FVector New = Old + Vel * Dt + FVector(0.f, 0.f, VelZ * Dt);
	New.Z = FMath::Min(New.Z, 90000.f);
	const float G = GroundBelow(FVector(New.X, New.Y, Old.Z));
	float Bottom = New.Z - HalfHeight - Clearance;
	if (Bottom <= G)
	{
		const float Impact = -VelZ / SH::M;
		Bottom = G;
		if (bDead && WreckTimer < 20.f && !bCrushed)
		{
			bCrushed = true; // reuse flag: crashed down
			GM->Explode(GetActorLocation(), 12.f, bLastHitByPlayer, this);
		}
		if (Impact > 12.f && !bDead) Damage((Impact - 12.f) * 120.f, false);
		VelZ = FMath::Max(0.f, VelZ);
		Vel *= FMath::Exp(-4.f * Dt);
		bGrounded = true;
	}
	else bGrounded = Bottom - G < 20.f;
	if (GM->World->IsWater(New.X / SH::M, New.Y / SH::M) && Bottom < 50.f && !bDead)
	{
		bDead = true; Health = 0.f; bSunk = true;
		GM->OnVehicleSunk(this);
	}
	New.Z = Bottom + Clearance + HalfHeight;
	SetActorRotation(FRotator(0.f, Yaw, 0.f));
	FHitResult Hit;
	SetActorLocation(New, true, &Hit);
	if (Hit.bBlockingHit)
	{
		FVector N = Hit.ImpactNormal; N.Z = 0.f;
		if (N.Normalize())
		{
			const float Vn = FVector::DotProduct(Vel, N);
			if (Vn < 0.f)
			{
				Vel -= N * Vn * 1.5f;
				if (-Vn > 800.f)
				{
					Damage((-Vn / SH::M - 8.f) * 60.f, false);
					GM->OnVehicleCrash(this, -Vn / SH::M, Hit.ImpactPoint);
				}
			}
		}
	}
	AirTime = 0.f;
}

// ------------------------------------------------------------------ damage
void ASHVehicle::Damage(float Amount, bool bByPlayer, bool bExplosion)
{
	if (bDead || Amount <= 0.f) return;
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (Kind == ESHVehicleKind::Tank) Amount *= bExplosion ? 0.25f : 0.05f;
	if (bPlayerDriven && GM->bGodMode) return;
	if (bByPlayer) bLastHitByPlayer = true;
	Health -= Amount;
	if (Health <= MaxHealth * 0.12f) bOnFire = true;
	if (Health <= 0.f) Explode();
}

void ASHVehicle::Explode()
{
	if (bDead) return;
	bDead = true;
	bOnFire = true;
	Health = 0.f;
	ASHGameMode* GM = ASHGameMode::Get(this);
	UMaterialInstanceDynamic* Charred = GM->ColorMat(SH::Hex(TEXT("1A1816")));
	for (UStaticMeshComponent* P : PaintParts) if (P) P->SetMaterial(0, Charred);
	if (SirenRed) SirenRed->SetIntensity(0.f);
	if (SirenBlue) SirenBlue->SetIntensity(0.f);
	bSiren = false;
	if (!Def->bHeli) { VelZ = FMath::FRandRange(700.f, 1100.f); bGrounded = false; }
	GM->Explode(GetActorLocation(), Def->bHeli ? 14.f : 11.f, bLastHitByPlayer, this);
	GM->OnVehicleDestroyed(this);
}

void ASHVehicle::Crush(ASHVehicle* By)
{
	if (!bCrushed)
	{
		bCrushed = true;
		Damage(MaxHealth * 0.95f, By && By->bPlayerDriven);
		Vel *= 0.2f;
		Body->SetRelativeScale3D(FVector(1.f, 1.f, 0.45f));
		ASHGameMode::Get(this)->OnCrush(this, By);
	}
	if (By)
	{
		By->VelZ = FMath::Max(By->VelZ, 300.f);
		By->bGrounded = false;
	}
}

// ---------------------------------------------------------------- visuals
void ASHVehicle::UpdateVisuals(float Dt)
{
	const float Vf = ForwardSpeed();
	float Pitch = 0.f, Roll = 0.f;
	if (Def->bHeli)
	{
		Pitch = bDead ? 15.f : -(bPlayerDriven || Mode == ESHDriveMode::HeliPatrol ? Throttle : 0.f) * 14.f;
		Roll = FMath::Clamp(YawRate * 0.15f, -20.f, 20.f);
		if (Rotor) Rotor->AddLocalRotation(FRotator(0.f, RotorSpeed * 1700.f * Dt, 0.f));
	}
	else
	{
		Pitch = FMath::RadiansToDegrees(FMath::Atan2(VelZ, FMath::Max(FMath::Abs(Vf), 100.f))) * (bGrounded ? 0.8f : 0.6f);
		Roll = FMath::Clamp(YawRate * FMath::Abs(Vf) / SH::M * 0.0035f, -6.f, 6.f);
		if (Kind == ESHVehicleKind::Bike) Roll = FMath::Clamp(YawRate * FMath::Abs(Vf) / SH::M * 0.018f, -40.f, 40.f);
		const float SpinDeg = FMath::RadiansToDegrees(Vf * Dt / (FMath::Max(0.2f, Def->WheelR) * SH::M));
		for (USceneComponent* W : Wheels) if (W) W->AddLocalRotation(FRotator(-SpinDeg, 0.f, 0.f));
		SteerVis = FMath::FInterpTo(SteerVis, (bPlayerDriven || Mode != ESHDriveMode::None ? Steer : 0.f) * 28.f, Dt, 10.f);
		for (USceneComponent* S : SteerWheels) if (S) S->SetRelativeRotation(FRotator(0.f, SteerVis, 0.f));
		if (Turret) Turret->SetRelativeRotation(FRotator(0.f, TurretYaw - Yaw, 0.f));
	}
	PitchVis = FMath::FInterpTo(PitchVis, Pitch, Dt, 8.f);
	RollVis = FMath::FInterpTo(RollVis, Roll, Dt, 8.f);
	Body->SetRelativeRotation(FRotator(PitchVis, 0.f, RollVis));
	if (bSunk) Body->SetRelativeLocation(FVector(0.f, 0.f, -(Clearance + HalfHeight) - 80.f));
	if (SirenRed && SirenBlue && !bDead)
	{
		SirenTime += Dt;
		const bool bBlink = FMath::Fmod(SirenTime, 0.28f) < 0.14f;
		SirenRed->SetIntensity(bSiren && bBlink ? 8000.f : 0.f);
		SirenBlue->SetIntensity(bSiren && !bBlink ? 8000.f : 0.f);
	}
}

// ------------------------------------------------------------------ input
void ASHVehicle::SetupPlayerInputComponent(UInputComponent* In)
{
	Super::SetupPlayerInputComponent(In);
	In->BindAxis("MoveForward", this, &ASHVehicle::InThrottle);
	In->BindAxis("MoveRight", this, &ASHVehicle::InSteer);
	In->BindAxis("Lift", this, &ASHVehicle::InLift);
	In->BindAxis("Turn", this, &ASHVehicle::InTurn);
	In->BindAxis("LookUp", this, &ASHVehicle::InLookUp);
	In->BindAction("Handbrake", IE_Pressed, this, &ASHVehicle::HandbrakeOn);
	In->BindAction("Handbrake", IE_Released, this, &ASHVehicle::HandbrakeOff);
	In->BindAction("Nitro", IE_Pressed, this, &ASHVehicle::NitroOn);
	In->BindAction("Nitro", IE_Released, this, &ASHVehicle::NitroOff);
	In->BindAction("Fire", IE_Pressed, this, &ASHVehicle::FireOn);
	In->BindAction("Fire", IE_Released, this, &ASHVehicle::FireOff);
	In->BindAction("Horn", IE_Pressed, this, &ASHVehicle::HornPressed);
	In->BindAction("Enter", IE_Pressed, this, &ASHVehicle::ExitPressed);
}

void ASHVehicle::InTurn(float V)
{
	if (FMath::Abs(V) > 0.01f) CamIdle = 0.f;
	AddControllerYawInput(V);
}

void ASHVehicle::InLookUp(float V)
{
	if (FMath::Abs(V) > 0.01f) CamIdle = 0.f;
	AddControllerPitchInput(V);
}

void ASHVehicle::HornPressed()
{
	if (Def && Def->bPolice) bSiren = !bSiren;
}

void ASHVehicle::ExitPressed()
{
	if (ASHGameMode* GM = ASHGameMode::Get(this)) GM->ExitVehicle();
}

void ASHVehicle::HandlePlayerWeapons(float Dt)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	FireCooldown -= Dt;
	// camera auto-centres behind the car when the mouse is idle
	CamIdle += Dt;
	if (AController* C = GetController())
	{
		if (CamIdle > 1.f && (SpeedMs() > 3.f || Def->bHeli))
		{
			const FRotator Cur = C->GetControlRotation();
			const FRotator Want(Def->bHeli ? -18.f : -10.f, Yaw, 0.f);
			C->SetControlRotation(FMath::RInterpTo(Cur, Want, Dt, Def->bHeli ? 1.5f : 3.f));
		}
		Camera->SetFieldOfView(FMath::FInterpTo(Camera->FieldOfView, 75.f + FMath::Clamp(SpeedMs() - 15.f, 0.f, 50.f) * 0.35f + (bNitro && GM->Nitro > 0.f ? 8.f : 0.f), Dt, 4.f));
		if (Kind == ESHVehicleKind::Tank) TurretYaw = C->GetControlRotation().Yaw;
	}
	if (!bFiring || FireCooldown > 0.f || bDead) return;
	const FVector Aim = GM->AimPoint(Camera->GetComponentLocation(), Camera->GetForwardVector(), this);
	if (Kind == ESHVehicleKind::Tank)
	{
		FireCooldown = 1.1f;
		const FVector Muzzle = GetActorLocation() + FRotator(0.f, TurretYaw, 0.f).Vector() * 620.f + FVector(0.f, 0.f, 150.f);
		GM->SpawnRocket(Muzzle, (Aim - Muzzle).GetSafeNormal(), this, true, 14000.f, 14.f);
		Vel -= FRotator(0.f, TurretYaw, 0.f).Vector() * 150.f;
	}
	else if (Kind == ESHVehicleKind::Heli)
	{
		FireCooldown = 0.35f;
		static float Side = 1.f;
		Side = -Side;
		const FVector Muzzle = GetActorLocation() + Forward() * 150.f + FVector(-Forward().Y, Forward().X, 0.f) * 140.f * Side;
		GM->SpawnRocket(Muzzle, (Aim - Muzzle).GetSafeNormal(), this, true, 9000.f, 9.f);
	}
	else if (!Def->bHeli)
	{
		// drive-by with the player's current gun
		if (GM->PlayerChar) GM->PlayerChar->FireWeapon(GetActorLocation() + FVector(0.f, 0.f, Def->Hgt * 80.f), Aim, this);
		const FSHWeaponDef& W = SHWeaponDef(GM->PlayerChar ? GM->PlayerChar->Weapon : ESHWeapon::Pistol);
		FireCooldown = W.bMelee ? 0.5f : W.Rate;
		if (!W.bAuto) bFiring = false;
	}
	GM->ReportCrime(ESHCrime::Gunfire, GetActorLocation());
}

// --------------------------------------------------------------------- AI
FVector2D ASHVehicle::LanePoint(int32 E, int32 From, float S, float InLane) const
{
	const ASHWorldBuilder* W = ASHGameMode::Get(this)->World;
	const FSHRoadEdge& Ed = W->Edges[E];
	const FVector2D A = W->Nodes[From].P, B = W->Nodes[Ed.Other(From)].P;
	const FVector2D D = (B - A) / FMath::Max(1.f, Ed.Len);
	return A + D * S + FVector2D(-D.Y, D.X) * InLane;
}

void ASHVehicle::PlaceOnEdge(int32 InEdge, int32 InFrom, float T)
{
	const ASHWorldBuilder* W = ASHGameMode::Get(this)->World;
	const FSHRoadEdge& E = W->Edges[InEdge];
	EdgeId = InEdge; FromNode = InFrom; ToNode = E.Other(InFrom);
	Lane = E.bHighway ? (FMath::RandBool() ? 4.f : 10.5f) : 4.5f;
	NextEdge = -1;
	const FVector2D P = LanePoint(InEdge, InFrom, E.Len * T, Lane);
	const FVector2D D = (W->Nodes[ToNode].P - W->Nodes[FromNode].P).GetSafeNormal();
	Yaw = FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X));
	const float G = W->GroundZ(SH::W(P.X, P.Y, 2.f), 100.f);
	SetActorLocationAndRotation(FVector(P.X * SH::M, P.Y * SH::M, G + Clearance + HalfHeight), FRotator(0.f, Yaw, 0.f));
	const float Sp = FMath::Min(E.bHighway ? 30.f : 15.f, 14.f) * SH::M;
	Vel = FVector(D.X, D.Y, 0.f) * Sp;
}

bool ASHVehicle::AttachToRoad()
{
	const ASHWorldBuilder* W = ASHGameMode::Get(this)->World;
	const FVector2D P(GetActorLocation().X / SH::M, GetActorLocation().Y / SH::M);
	float Best = TNumericLimits<float>::Max();
	int32 BestE = -1;
	for (int32 i = 0; i < W->Edges.Num(); ++i)
	{
		const FSHRoadEdge& E = W->Edges[i];
		const FVector2D A = W->Nodes[E.A].P, AB = W->Nodes[E.B].P - A;
		const float T = FMath::Clamp(FVector2D::DotProduct(P - A, AB) / FMath::Max(1.f, AB.SizeSquared()), 0.f, 1.f);
		const float D = FVector2D::DistSquared(P, A + AB * T);
		if (D < Best) { Best = D; BestE = i; }
	}
	if (BestE < 0) return false;
	const FSHRoadEdge& E = W->Edges[BestE];
	const FVector2D AB = W->Nodes[E.B].P - W->Nodes[E.A].P;
	const FVector Fw = Forward();
	const bool bFwd = AB.X * Fw.X + AB.Y * Fw.Y > 0.f;
	EdgeId = BestE; FromNode = bFwd ? E.A : E.B; ToNode = E.Other(FromNode);
	Lane = E.bHighway ? 4.f : 4.5f;
	NextEdge = -1;
	return true;
}

void ASHVehicle::ChooseNext()
{
	const ASHWorldBuilder* W = ASHGameMode::Get(this)->World;
	const FSHRoadNode& N = W->Nodes[ToNode];
	TArray<int32> Opts;
	for (int32 E : N.Edges) if (W->Edges[E].Other(ToNode) != FromNode) Opts.Add(E);
	if (Opts.Num() == 0) Opts = N.Edges;
	NextEdge = Opts.Num() ? Opts[FMath::RandRange(0, Opts.Num() - 1)] : -1;
}

void ASHVehicle::TickAI(float Dt)
{
	if (Mode == ESHDriveMode::HeliPatrol) { AIHeli(Dt); return; }
	FVector2D Target;
	float Desired = 0.f;
	switch (Mode)
	{
	case ESHDriveMode::Chase: AIChase(Dt, Target, Desired); break;
	case ESHDriveMode::Race: AIRace(Dt, Target, Desired); break;
	default: AITraffic(Dt, Target, Desired); break;
	}
	DriveToward(Target, Desired, Dt);
}

void ASHVehicle::DriveToward(const FVector2D& Target, float DesiredMs, float Dt)
{
	const FVector L = GetActorLocation();
	const float Want = FMath::RadiansToDegrees(FMath::Atan2(Target.Y * SH::M - L.Y, Target.X * SH::M - L.X));
	const float Diff = FMath::FindDeltaAngleDegrees(Yaw, Want);
	const float Vf = ForwardSpeed() / SH::M;
	float S = FMath::Clamp(Diff / 25.f, -1.f, 1.f);
	float T = FMath::Clamp((DesiredMs - Vf) * 0.35f, -1.f, 1.f);
	if (FMath::Abs(Diff) > 70.f && Vf > 12.f) T = FMath::Min(T, -0.4f);
	if (Reverse > 0.f)
	{
		Reverse -= Dt;
		T = -1.f; S = -S;
	}
	else if (T > 0.2f && FMath::Abs(Vf) < 1.2f && bGrounded)
	{
		Stuck += Dt;
		if (Stuck > 1.6f) { Reverse = 1.2f; Stuck = 0.f; ++StuckCount; }
	}
	else Stuck = FMath::Max(0.f, Stuck - Dt);
	Steer = S;
	Throttle = T;
	bHandbrake = DesiredMs <= 0.f && FMath::Abs(Vf) < 1.f;
}

void ASHVehicle::AITraffic(float Dt, FVector2D& Target, float& Desired)
{
	const ASHWorldBuilder* W = ASHGameMode::Get(this)->World;
	if (EdgeId < 0 && !AttachToRoad()) { Target = FVector2D(GetActorLocation()) / SH::M; Desired = 0.f; return; }
	const FSHRoadEdge& E = W->Edges[EdgeId];
	const FVector2D A = W->Nodes[FromNode].P, B = W->Nodes[ToNode].P;
	const FVector2D D = (B - A) / FMath::Max(1.f, E.Len);
	const FVector2D P(GetActorLocation().X / SH::M, GetActorLocation().Y / SH::M);
	const float S = FVector2D::DotProduct(P - A, D);
	if (NextEdge < 0 && S > E.Len - 30.f) ChooseNext();
	if (S >= E.Len - 2.f && NextEdge >= 0)
	{
		FromNode = ToNode;
		EdgeId = NextEdge;
		ToNode = W->Edges[EdgeId].Other(FromNode);
		const bool bHwy = W->Edges[EdgeId].bHighway;
		if (bHwy && Lane < 4.f) Lane = 4.f;
		if (!bHwy) Lane = 4.5f;
		NextEdge = -1;
		AITraffic(Dt, Target, Desired);
		return;
	}
	const float Look = FMath::Clamp(FMath::Abs(ForwardSpeed() / SH::M) * 0.6f, 6.f, 22.f);
	if (S + Look < E.Len || NextEdge < 0) Target = LanePoint(EdgeId, FromNode, FMath::Min(E.Len, S + Look), Lane);
	else
	{
		const FSHRoadEdge& NE = W->Edges[NextEdge];
		Target = LanePoint(NextEdge, ToNode, FMath::Min(NE.Len, S + Look - E.Len), NE.bHighway ? FMath::Max(Lane, 4.f) : 4.5f);
	}
	Desired = (E.bHighway ? 32.f : 15.f) * Skill;
	if (Panic > 0.f) { Panic -= Dt; Desired *= 1.6f; }
	if (NextEdge >= 0 && S > E.Len - 28.f)
	{
		const FVector2D N = W->Nodes[W->Edges[NextEdge].Other(ToNode)].P;
		const float Turn = FMath::Abs(FMath::FindDeltaAngleRadians(FMath::Atan2(D.Y, D.X), FMath::Atan2(N.Y - B.Y, N.X - B.X)));
		if (Turn > 0.4f) Desired = FMath::Min(Desired, Panic > 0.f ? 14.f : 8.f);
	}
	Desired = FMath::Min(Desired, ObstacleLimit(Desired));
}

float ASHVehicle::ObstacleLimit(float Desired) const
{
	const ASHGameMode* GM = ASHGameMode::Get(this);
	const FVector L = GetActorLocation();
	const FVector F = Forward();
	float Lim = Desired;
	auto Check = [&](const FVector& O, float Pad)
	{
		const FVector D = (O - L) / SH::M;
		const float Ahead = D.X * F.X + D.Y * F.Y;
		if (Ahead <= 0.f || Ahead > 26.f) return;
		const float Side = FMath::Abs(-D.X * F.Y + D.Y * F.X);
		if (Side > Pad) return;
		Lim = FMath::Min(Lim, FMath::Max(0.f, (Ahead - Def->Len * 0.5f - 3.f) * 0.9f));
	};
	for (ASHVehicle* O : GM->Vehicles)
	{
		if (!O || O == this || !O->Def || O->Def->bHeli) continue;
		if (FVector::DistSquared2D(O->GetActorLocation(), L) > 3000.f * 3000.f) continue;
		Check(O->GetActorLocation(), 2.6f);
	}
	for (AActor* P : GM->PedActors())
		if (P && FVector::DistSquared2D(P->GetActorLocation(), L) < 2600.f * 2600.f) Check(P->GetActorLocation(), 1.8f);
	if (Panic > 0.f) Lim = FMath::Max(Lim, Desired * 0.5f);
	return Lim;
}

void ASHVehicle::AIChase(float Dt, FVector2D& Target, float& Desired)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	const ASHWorldBuilder* W = GM->World;
	bSiren = true;
	const FVector PP = GM->PlayerPos();
	const float D = FVector::Dist2D(PP, GetActorLocation()) / SH::M;
	const bool bPlayerInCar = GM->PlayerVehicle != nullptr;
	if (GM->WantedLevel >= 2 && D < 45.f && !GM->bPlayerDead)
	{
		ShootCd -= Dt;
		if (ShootCd <= 0.f)
		{
			ShootCd = FMath::FRandRange(0.6f, 1.3f) / (GM->WantedLevel >= 4 ? 1.6f : 1.f);
			const FVector From = GetActorLocation() + FVector(0.f, 0.f, 100.f);
			if (W->LineOfSight(From, PP + FVector(0.f, 0.f, 80.f), this, GM->PlayerVehicle)) GM->NpcShoot(From, 0.4f, 7.f, this);
		}
	}
	if (!bPlayerInCar && D < 26.f)
	{
		if (!bCopsOut && FMath::Abs(ForwardSpeed()) < 300.f)
		{
			bCopsOut = true;
			GM->SpawnCopsFromCar(this);
		}
		Target = FVector2D(PP.X, PP.Y) / SH::M;
		Desired = 0.f;
		return;
	}
	if (bPlayerInCar) bCopsOut = false;
	FVector2D Tp(PP.X / SH::M, PP.Y / SH::M);
	if (GM->PlayerVehicle) Tp += FVector2D(GM->PlayerVehicle->Vel.X, GM->PlayerVehicle->Vel.Y) / SH::M * 0.5f;
	if (D < 70.f) { Target = Tp; Desired = Def->MaxSpeed * 0.95f; return; }
	Repath -= Dt;
	if (Repath <= 0.f || Path.Num() == 0)
	{
		Repath = 1.5f;
		const FVector Ahead = GetActorLocation() + Forward() * 2500.f;
		W->FindPath(W->NearestNode(Ahead.X / SH::M, Ahead.Y / SH::M), W->NearestNode(Tp.X, Tp.Y), Path);
		PathIdx = 0;
	}
	if (Path.IsValidIndex(PathIdx))
	{
		FVector2D N = W->Nodes[Path[PathIdx]].P;
		const FVector2D Me(GetActorLocation().X / SH::M, GetActorLocation().Y / SH::M);
		if (FVector2D::Distance(Me, N) < 14.f) ++PathIdx;
		if (Path.IsValidIndex(PathIdx))
		{
			N = W->Nodes[Path[PathIdx]].P;
			Target = N;
			Desired = (PathIdx + 1 < Path.Num() && FVector2D::Distance(Me, N) < 35.f) ? 18.f : Def->MaxSpeed * 0.9f;
			return;
		}
	}
	Target = Tp;
	Desired = Def->MaxSpeed * 0.9f;
}

void ASHVehicle::AIRace(float Dt, FVector2D& Target, float& Desired)
{
	if (!RaceCheckpoints.IsValidIndex(RaceIdx)) { Target = FVector2D(GetActorLocation()) / SH::M; Desired = 0.f; return; }
	const FVector2D Me(GetActorLocation().X / SH::M, GetActorLocation().Y / SH::M);
	const FVector2D Cp = RaceCheckpoints[RaceIdx];
	const float D = FVector2D::Distance(Me, Cp);
	if (D < 12.f) ++RaceIdx;
	Desired = FMath::Min(56.f, Def->MaxSpeed * Skill) * Rubber;
	if (RaceCheckpoints.IsValidIndex(RaceIdx + 1))
	{
		const FVector2D Nx = RaceCheckpoints[RaceIdx + 1];
		const float Turn = FMath::Abs(FMath::FindDeltaAngleRadians(FMath::Atan2(Cp.Y - Me.Y, Cp.X - Me.X), FMath::Atan2(Nx.Y - Cp.Y, Nx.X - Cp.X)));
		if (Turn > 0.5f)
		{
			const float Vc = 12.f + (PI - Turn) * 4.f;
			const float Vf = FMath::Max(0.f, ForwardSpeed() / SH::M);
			const float BrakeDist = FMath::Max(0.f, (Vf * Vf - Vc * Vc) / (2.f * Def->Brake * 0.55f));
			if (D < BrakeDist + 14.f) Desired = FMath::Min(Desired, Vc);
		}
	}
	Target = RaceCheckpoints.IsValidIndex(RaceIdx) ? RaceCheckpoints[RaceIdx] : Cp;
}

void ASHVehicle::AIHeli(float Dt)
{
	ASHGameMode* GM = ASHGameMode::Get(this);
	const FVector PP = GM->PlayerPos();
	const bool bLeaving = GM->WantedLevel == 0;
	Orbit += Dt * 0.25f;
	FVector Tgt = bLeaving ? GetActorLocation() + Forward() * 20000.f : PP + FVector(FMath::Cos(Orbit), FMath::Sin(Orbit), 0.f) * 3500.f;
	Tgt.Z = bLeaving ? 12000.f : FMath::Max(PP.Z, 0.f) + 3800.f;
	Lift = FMath::Clamp((Tgt.Z - GetActorLocation().Z) * 0.0015f - VelZ * 0.002f, -1.f, 1.f);
	const FVector ToT = Tgt - GetActorLocation();
	const float Dist = ToT.Size2D();
	const float Face = bLeaving ? Yaw : FMath::RadiansToDegrees(FMath::Atan2(PP.Y - GetActorLocation().Y, PP.X - GetActorLocation().X));
	const float Travel = FMath::RadiansToDegrees(FMath::Atan2(ToT.Y, ToT.X));
	Steer = FMath::Clamp(FMath::FindDeltaAngleDegrees(Yaw, Dist > 6000.f ? Travel : Face) / 30.f, -1.f, 1.f);
	const FVector Dir = ToT.GetSafeNormal2D();
	const float WantV = FMath::Min(Dist * 0.5f, 4500.f);
	Vel += (Dir * WantV - Vel) * Dt * 0.6f;
	Throttle = 0.f;
	if (!bLeaving && GM->WantedLevel >= 3 && !GM->bPlayerDead)
	{
		ShootCd -= Dt;
		if (ShootCd <= 0.f && FVector::Dist2D(PP, GetActorLocation()) < 9000.f)
		{
			ShootCd = FMath::FRandRange(0.15f, 0.3f);
			const FVector From = GetActorLocation() - FVector(0.f, 0.f, 100.f);
			if (GM->World->LineOfSight(From, PP + FVector(0.f, 0.f, 80.f), this, GM->PlayerVehicle)) GM->NpcShoot(From, 0.35f, 6.f, this);
		}
	}
}
