#include "SHGameMode.h"
#include "SHWorldBuilder.h"
#include "SHVehicle.h"
#include "SHPed.h"
#include "SHPlayerCharacter.h"
#include "SHPlayerController.h"
#include "SHHUD.h"
#include "SHFx.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Kismet/GameplayStatics.h"
#include "CollisionQueryParams.h"

namespace
{
	FVector2D BlockPos(float CX, float CZ, int32 I, int32 J) { return FVector2D(CX + (I - 3.5f) * 100.f, CZ + (J - 3.5f) * 100.f); }
	FVector2D NodePos(float CX, float CZ, int32 I, int32 J) { return FVector2D(CX + (I - 4) * 100.f, CZ + (J - 4) * 100.f); }
	const FVector2D DALLAS(-2200.f, -600.f), NOLA(0.f, 1300.f), ATL(2200.f, -600.f);

	FLinearColor RandomPaint(ESHVehicleKind K)
	{
		static const TCHAR* Sedan[] = { TEXT("8A1C1C"), TEXT("1C3F8A"), TEXT("E8E8E8"), TEXT("2B2B2B"), TEXT("6B7A8A"), TEXT("3A6B3A"), TEXT("B8A888") };
		static const TCHAR* Sporty[] = { TEXT("FF2A2A"), TEXT("FFCC00"), TEXT("00C2FF"), TEXT("FF6A00"), TEXT("111111"), TEXT("B400FF"), TEXT("00D27A") };
		switch (K)
		{
		case ESHVehicleKind::Police: return SH::Hex(TEXT("111111"));
		case ESHVehicleKind::PoliceHeli: return SH::Hex(TEXT("1C2C5A"));
		case ESHVehicleKind::Taxi: return SH::Hex(TEXT("FFC81A"));
		case ESHVehicleKind::Tank: return SH::Hex(TEXT("4B5A32"));
		case ESHVehicleKind::Monster: return SH::Hex(TEXT("7A3FBF"));
		case ESHVehicleKind::Sports: case ESHVehicleKind::Bike: case ESHVehicleKind::Muscle: return SH::Hex(Sporty[FMath::RandRange(0, 6)]);
		default: return SH::Hex(Sedan[FMath::RandRange(0, 6)]);
		}
	}
}

ASHGameMode::ASHGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = false;
	DefaultPawnClass = ASHPlayerCharacter::StaticClass();
	PlayerControllerClass = ASHPlayerController::StaticClass();
	HUDClass = ASHHUD::StaticClass();
}

ASHGameMode* ASHGameMode::Get(const UObject* WorldContext)
{
	return Cast<ASHGameMode>(UGameplayStatics::GetGameMode(WorldContext));
}

// ------------------------------------------------------------------ assets
void ASHGameMode::EnsureAssets()
{
	if (CubeMesh) return;
	CubeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	CylinderMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	SphereMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	ConeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cone.Cone"));
	BaseMaterial = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
}

UMaterialInstanceDynamic* ASHGameMode::ColorMat(const FLinearColor& C)
{
	EnsureAssets();
	const FString Key = C.ToFColor(true).ToHex();
	if (TObjectPtr<UMaterialInstanceDynamic>* Found = MatCache.Find(Key)) return Found->Get();
	UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(BaseMaterial, this);
	M->SetVectorParameterValue(TEXT("Color"), C);
	MatCache.Add(Key, M);
	return M;
}

UStaticMeshComponent* ASHGameMode::AddPart(AActor* OwnerActor, USceneComponent* Parent, UStaticMesh* Mesh, const FVector& LocCm, const FVector& SizeM, const FLinearColor& Color, const FRotator& Rot)
{
	UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(OwnerActor);
	C->SetStaticMesh(Mesh);
	C->SetupAttachment(Parent);
	C->SetRelativeLocation(LocCm);
	C->SetRelativeRotation(Rot);
	C->SetRelativeScale3D(SizeM);
	C->SetMaterial(0, ColorMat(Color));
	C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	C->SetCanEverAffectNavigation(false);
	C->SetGenerateOverlapEvents(false);
	C->RegisterComponent();
	OwnerActor->AddInstanceComponent(C);
	return C;
}

// ---------------------------------------------------------------- startup
void ASHGameMode::RestartPlayer(AController* NewPlayer)
{
	if (!bWorldBuilt) { PendingPlayers.AddUnique(NewPlayer); return; }
	SpawnPlayer(NewPlayer);
}

void ASHGameMode::BeginPlay()
{
	Super::BeginPlay();
	BuildWorld();
	for (AController* C : PendingPlayers) if (C) SpawnPlayer(C);
	PendingPlayers.Empty();
}

void ASHGameMode::BuildWorld()
{
	EnsureAssets();
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	World = GetWorld()->SpawnActor<ASHWorldBuilder>(ASHWorldBuilder::StaticClass(), FTransform::Identity, P);
	World->Build();
	bWorldBuilt = true;
	SetupMissions();
	// pickups
	for (FSHPickup& Pk : World->Pickups)
	{
		ASHProp* Prop = GetWorld()->SpawnActor<ASHProp>(ASHProp::StaticClass(), SH::W(Pk.P.X, Pk.P.Y, Pk.Up + 1.f), FRotator::ZeroRotator, P);
		const FLinearColor C = Pk.Type == 1 ? SH::Hex(TEXT("4CFF6A")) : Pk.Type == 2 ? SH::Hex(TEXT("4AA3DF")) : Pk.Weapon == ESHWeapon::Minigun ? SH::Hex(TEXT("FF33CC")) : Pk.Weapon == ESHWeapon::RPG ? SH::Hex(TEXT("FF4D4D")) : SH::Hex(TEXT("FFCF33"));
		if (Pk.Type == 1)
		{
			AddPart(Prop, Prop->Root, CubeMesh, FVector::ZeroVector, FVector(0.9f, 0.3f, 0.3f), C);
			AddPart(Prop, Prop->Root, CubeMesh, FVector::ZeroVector, FVector(0.3f, 0.3f, 0.9f), C);
		}
		else if (Pk.Type == 2) AddPart(Prop, Prop->Root, SphereMesh, FVector::ZeroVector, FVector(0.7f, 0.7f, 0.9f), C);
		else AddPart(Prop, Prop->Root, CubeMesh, FVector::ZeroVector, FVector(1.f, 0.2f, 0.35f), C);
		AddPart(Prop, Prop->Root, CylinderMesh, FVector(0.f, 0.f, -80.f), FVector(1.6f, 1.6f, 0.03f), C);
		Prop->Spin = 120.f;
		Prop->BobHeight = 15.f;
		Prop->BaseLocation = Prop->GetActorLocation();
		Pk.Visual = Prop;
	}
}

void ASHGameMode::SpawnPlayer(AController* C)
{
	FVector2D Start = World && World->Safehouses.Num() ? World->Safehouses[0] + FVector2D(0.f, 4.f) : FVector2D(-2200.f, -600.f);
	const FTransform T(FRotator(0.f, 90.f, 0.f), SH::W(Start.X, Start.Y, 1.5f));
	RestartPlayerAtTransform(C, T);
	PlayerChar = Cast<ASHPlayerCharacter>(C->GetPawn());
	C->SetControlRotation(FRotator(-10.f, 90.f, 0.f));
	ShowBig(TEXT("DALLAS"), SH::Hex(TEXT("FFB347")), 3.f, TEXT("WELCOME TO"));
	ShowHelp(TEXT("Welcome to the Southern Triangle.\nF: steal a car   M: map + GPS   H: help\nWalk into the coloured mission markers to start missions.\nOpen the console with ~ and type: Cheat HESOYAM"), 12.f);
}

// ------------------------------------------------------------------- tick
void ASHGameMode::Tick(float Dt)
{
	Super::Tick(Dt);
	if (!bWorldBuilt) return;
	const float Dilation = FMath::Max(0.05f, UGameplayStatics::GetGlobalTimeDilation(this));
	const float RealDt = Dt / Dilation;

	// slow motion: death, big air, cheat
	float TargetDilation = 1.f;
	if (bPlayerDead) TargetDilation = 0.35f;
	else if (PlayerVehicle && !PlayerVehicle->Def->bHeli && !PlayerVehicle->bGrounded && PlayerVehicle->AirTime > 0.45f && PlayerVehicle->MaxAir > 4.f) TargetDilation = 0.4f;
	else if (bSlowMo) TargetDilation = 0.5f;
	UGameplayStatics::SetGlobalTimeDilation(this, FMath::FInterpTo(Dilation, TargetDilation, RealDt, 6.f));

	BigTimer -= RealDt; HelpTimer -= RealDt; HintTimer -= RealDt; StuntTimer -= RealDt; DamageFlash -= RealDt;
	MissionCooldown -= Dt;
	Nitro = FMath::Min(1.f, Nitro + Dt * 0.05f);
	if (PlayerVehicle && PlayerChar) PlayerChar->SetActorLocation(PlayerVehicle->GetActorLocation() + FVector(0.f, 0.f, 250.f));

	if (bPlayerDead)
	{
		RespawnTimer -= RealDt;
		if (RespawnTimer <= 0.f) Respawn();
	}
	if (GetWorld()->GetTimeSeconds() - BustSeen > 0.5f) BustAccum = 0.f;

	UpdateSky(Dt);
	UpdateWanted(Dt);
	UpdatePopulation(Dt);
	UpdatePickups(Dt);
	UpdateMissions(Dt);
	UpdateZone();

	if (Armageddon > 0.f)
	{
		Armageddon -= Dt;
		const FVector PP = PlayerPos();
		if (FMath::FRand() < Dt * 4.f)
		{
			const float A = FMath::FRandRange(0.f, 2.f * PI), R = FMath::FRandRange(1500.f, 9000.f);
			SpawnRocket(PP + FVector(FMath::Cos(A) * R, FMath::Sin(A) * R, 16000.f), FVector(FMath::FRandRange(-0.1f, 0.1f), FMath::FRandRange(-0.1f, 0.1f), -1.f).GetSafeNormal(), nullptr, false, 9000.f, 12.f);
		}
	}
}

void ASHGameMode::UpdateSky(float Dt)
{
	Hour = FMath::Fmod(Hour + Dt * (bTimelapse ? 0.5f : 24.f / (16.f * 60.f)), 24.f);
	World->SetTimeOfDay(Hour);
}

FVector ASHGameMode::PlayerPos() const
{
	if (PlayerVehicle) return PlayerVehicle->GetActorLocation();
	return PlayerChar ? PlayerChar->GetActorLocation() : FVector::ZeroVector;
}

TArray<AActor*> ASHGameMode::PedActors() const
{
	TArray<AActor*> Out;
	for (ASHPed* P : Peds) if (P && P->IsAlive()) Out.Add(P);
	if (PlayerChar && !PlayerVehicle && !bPlayerDead) Out.Add(PlayerChar);
	return Out;
}

void ASHGameMode::UpdateZone()
{
	const FVector PP = PlayerPos();
	FString City; FLinearColor Col;
	World->ZoneName(PP.X / SH::M, PP.Y / SH::M, City, Col);
	if (!City.IsEmpty() && City != LastCity && GetWorld()->GetTimeSeconds() > 5.f) ShowBig(City, Col, 2.2f, TEXT("WELCOME TO"));
	LastCity = City;
}

// ---------------------------------------------------------------- messages
void ASHGameMode::ShowBig(const FString& Text, const FLinearColor& Color, float Duration, const FString& Sub)
{
	BigText = Text; BigSub = Sub; BigColor = Color; BigTimer = Duration;
}
void ASHGameMode::ShowHelp(const FString& Text, float Duration) { HelpText = Text; HelpTimer = Duration; }
void ASHGameMode::ShowHint(const FString& Text) { HintText = Text; HintTimer = 0.2f; }

// ---------------------------------------------------------------- spawning
ASHVehicle* ASHGameMode::SpawnVehicle(ESHVehicleKind Kind, const FVector2D& PosM, float YawDeg, float UpM, const FLinearColor& Paint)
{
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	const float G = World->GroundZ(SH::W(PosM.X, PosM.Y, UpM + 2.f), 200.f);
	ASHVehicle* V = GetWorld()->SpawnActor<ASHVehicle>(ASHVehicle::StaticClass(), FVector(PosM.X * SH::M, PosM.Y * SH::M, G + 200.f), FRotator(0.f, YawDeg, 0.f), P);
	if (!V) return nullptr;
	V->Init(Kind, Paint.A < 0.f ? RandomPaint(Kind) : Paint);
	if (V->Def->bHeli && UpM > 5.f)
	{
		V->SetActorLocation(FVector(PosM.X * SH::M, PosM.Y * SH::M, UpM * SH::M));
		V->RotorSpeed = 1.f;
		V->bGrounded = false;
	}
	Vehicles.Add(V);
	return V;
}

ASHVehicle* ASHGameMode::SpawnTraffic(bool bInCity)
{
	const FVector PP = PlayerPos();
	for (int32 Try = 0; Try < 20; ++Try)
	{
		const int32 E = FMath::RandRange(0, World->Edges.Num() - 1);
		const FSHRoadEdge& Ed = World->Edges[E];
		const float T = FMath::FRandRange(0.1f, 0.9f);
		const FVector2D P = FMath::Lerp(World->Nodes[Ed.A].P, World->Nodes[Ed.B].P, T);
		const float D = FVector2D::Distance(P, FVector2D(PP.X, PP.Y) / SH::M);
		if (D < 110.f || D > 330.f) continue;
		bool bBlocked = false;
		for (ASHVehicle* O : Vehicles) if (O && FVector2D::Distance(FVector2D(O->GetActorLocation()) / SH::M, P) < 16.f) { bBlocked = true; break; }
		if (bBlocked) continue;
		const int32 City = World->CityAt(P.X, P.Y);
		static const ESHVehicleKind DallasMix[] = { ESHVehicleKind::Pickup, ESHVehicleKind::Pickup, ESHVehicleKind::Pickup, ESHVehicleKind::Sedan, ESHVehicleKind::Sports, ESHVehicleKind::Muscle, ESHVehicleKind::Van, ESHVehicleKind::Bike, ESHVehicleKind::Taxi, ESHVehicleKind::Bus };
		static const ESHVehicleKind NolaMix[] = { ESHVehicleKind::Sedan, ESHVehicleKind::Sedan, ESHVehicleKind::Taxi, ESHVehicleKind::Taxi, ESHVehicleKind::Van, ESHVehicleKind::Van, ESHVehicleKind::Muscle, ESHVehicleKind::Pickup, ESHVehicleKind::Bike, ESHVehicleKind::Bus };
		static const ESHVehicleKind AtlMix[] = { ESHVehicleKind::Sedan, ESHVehicleKind::Sports, ESHVehicleKind::Sports, ESHVehicleKind::Muscle, ESHVehicleKind::Taxi, ESHVehicleKind::Van, ESHVehicleKind::Bike, ESHVehicleKind::Bike, ESHVehicleKind::Pickup, ESHVehicleKind::Bus };
		static const ESHVehicleKind HwyMix[] = { ESHVehicleKind::Sedan, ESHVehicleKind::Pickup, ESHVehicleKind::Pickup, ESHVehicleKind::Van, ESHVehicleKind::Muscle, ESHVehicleKind::Sports, ESHVehicleKind::Bus, ESHVehicleKind::Sedan, ESHVehicleKind::Bike, ESHVehicleKind::Sedan };
		const ESHVehicleKind* Mix = City == 0 ? DallasMix : City == 1 ? NolaMix : City == 2 ? AtlMix : HwyMix;
		ESHVehicleKind Kind = Mix[FMath::RandRange(0, 9)];
		if (SH::Chance(0.05f)) Kind = ESHVehicleKind::Police;
		ASHVehicle* V = SpawnVehicle(Kind, P, 0.f);
		if (!V) return nullptr;
		V->Mode = ESHDriveMode::Traffic;
		V->Skill = FMath::FRandRange(0.85f, 1.f);
		const int32 From = FMath::RandBool() ? Ed.A : Ed.B;
		V->PlaceOnEdge(E, From, From == Ed.A ? T : 1.f - T);
		return V;
	}
	return nullptr;
}

ASHPed* ASHGameMode::SpawnPed()
{
	const FVector PP = PlayerPos();
	for (int32 Try = 0; Try < 12; ++Try)
	{
		const int32 BI = FMath::RandRange(0, World->Blocks.Num() - 1);
		const FSHBlock& B = World->Blocks[BI];
		const float D = FVector2D::Distance(B.C, FVector2D(PP.X, PP.Y) / SH::M);
		if (D < 40.f || D > 180.f) continue;
		const float R = 38.3f;
		const int32 K = FMath::RandRange(0, 3);
		static const FVector2D Cn[4] = { FVector2D(-1, -1), FVector2D(1, -1), FVector2D(1, 1), FVector2D(-1, 1) };
		const FVector2D P = B.C + FMath::Lerp(Cn[K], Cn[(K + 1) % 4], FMath::FRand()) * R;
		if (FVector2D::Distance(P, FVector2D(PP.X, PP.Y) / SH::M) < 35.f) continue;
		ESHPedKind Kind = ESHPedKind::Civ;
		FLinearColor Gang = FLinearColor::Red;
		const bool bGangTurf = B.District == TEXT("Deep Ellum") || B.District == TEXT("Treme") || B.District == TEXT("Old Fourth Ward");
		if (bGangTurf && SH::Chance(0.22f))
		{
			Kind = ESHPedKind::Gang;
			Gang = B.City == 0 ? SH::Hex(TEXT("FF8C1A")) : B.City == 1 ? SH::Hex(TEXT("8E44AD")) : SH::Hex(TEXT("C0392B"));
		}
		else if (SH::Chance(0.03f)) Kind = ESHPedKind::Cop;
		FActorSpawnParameters SP;
		SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
		ASHPed* Ped = GetWorld()->SpawnActor<ASHPed>(ASHPed::StaticClass(), SH::W(P.X, P.Y, 1.3f), FRotator(0.f, FMath::FRandRange(0.f, 360.f), 0.f), SP);
		if (!Ped) return nullptr;
		Ped->Init(Kind, BI, B.City, Gang);
		Ped->Corner = (K + 1) % 4;
		Peds.Add(Ped);
		return Ped;
	}
	return nullptr;
}

void ASHGameMode::UpdatePopulation(float Dt)
{
	const FVector PP = PlayerPos();
	const FVector2D PM(PP.X / SH::M, PP.Y / SH::M);
	const bool bCity = World->CityAt(PM.X, PM.Y, 150.f) >= 0;
	TrafficTimer -= Dt; PedTimer -= Dt; ParkTimer -= Dt;

	if (TrafficTimer <= 0.f)
	{
		TrafficTimer = 0.25f;
		int32 Traffic = 0;
		for (ASHVehicle* V : Vehicles) if (V && V->Mode == ESHDriveMode::Traffic && !V->bDead) ++Traffic;
		if (Traffic < (bCity ? 22 : 10)) SpawnTraffic(bCity);
		for (int32 i = Vehicles.Num() - 1; i >= 0; --i)
		{
			ASHVehicle* V = Vehicles[i];
			if (!V) { Vehicles.RemoveAt(i); continue; }
			if (V->bPersistent || V->bPlayerDriven || V->bMissionVehicle) continue;
			if (V->Def->bPolice && WantedLevel > 0 && !V->bDead) continue;
			const float D = FVector::Dist2D(V->GetActorLocation(), PP) / SH::M;
			const float Lim = V->ParkSpot >= 0 ? 300.f : 440.f;
			if (D > Lim || (V->bDead && V->WreckTimer > 45.f && D > 60.f) || (V->StuckCount > 6 && D > 60.f))
			{
				if (World->ParkingSpots.IsValidIndex(V->ParkSpot)) World->ParkingSpots[V->ParkSpot].Car = nullptr;
				if (World->Specials.IsValidIndex(V->SpecialSpot)) World->Specials[V->SpecialSpot].Car = nullptr;
				PoliceUnits.Remove(V);
				Vehicles.RemoveAt(i);
				V->Destroy();
			}
		}
	}

	if (ParkTimer <= 0.f)
	{
		ParkTimer = 0.5f;
		for (int32 i = 0; i < World->ParkingSpots.Num(); ++i)
		{
			FSHSpot& S = World->ParkingSpots[i];
			const float D = FVector2D::Distance(S.P, PM);
			if (D < 200.f && !S.Car.IsValid() && !S.bCooldown)
			{
				static const ESHVehicleKind Park[] = { ESHVehicleKind::Sedan, ESHVehicleKind::Pickup, ESHVehicleKind::Sports, ESHVehicleKind::Muscle, ESHVehicleKind::Van, ESHVehicleKind::Taxi, ESHVehicleKind::Bike };
				ASHVehicle* V = SpawnVehicle(S.bPolice ? ESHVehicleKind::Police : Park[FMath::RandRange(0, 6)], S.P, S.Yaw);
				if (V) { V->Mode = ESHDriveMode::Parked; V->ParkSpot = i; S.Car = V; }
			}
			if (S.Car.IsValid() && FVector2D::Distance(FVector2D(S.Car->GetActorLocation()) / SH::M, S.P) > 8.f)
			{
				if (ASHVehicle* V = Cast<ASHVehicle>(S.Car.Get())) V->ParkSpot = -1;
				S.Car = nullptr;
				S.bCooldown = true;
			}
			if (S.bCooldown && D > 260.f) S.bCooldown = false;
		}
		for (int32 i = 0; i < World->Specials.Num(); ++i)
		{
			FSHSpecial& Sp = World->Specials[i];
			const float D = FVector2D::Distance(Sp.P, PM);
			if (D < 260.f && !Sp.Car.IsValid())
			{
				ASHVehicle* V = SpawnVehicle(Sp.Kind, Sp.P, Sp.Yaw, Sp.Up);
				if (V) { V->Mode = ESHDriveMode::Parked; V->SpecialSpot = i; Sp.Car = V; }
			}
		}
	}

	if (PedTimer <= 0.f)
	{
		PedTimer = 0.2f;
		int32 Civs = 0;
		for (ASHPed* P : Peds) if (P && P->Block >= 0) ++Civs;
		if (bCity && Civs < 36) SpawnPed();
		for (int32 i = Peds.Num() - 1; i >= 0; --i)
		{
			ASHPed* P = Peds[i];
			if (!P) { Peds.RemoveAt(i); continue; }
			const float D = FVector::Dist2D(P->GetActorLocation(), PP) / SH::M;
			const bool bGone = D > 230.f || (P->State == ESHPedState::Dead && (P->DeadTimer > 40.f || D > 120.f)) || (P->Block < 0 && P->State == ESHPedState::Idle && D > 90.f && WantedLevel == 0);
			if (bGone) { Peds.RemoveAt(i); P->Destroy(); }
		}
	}
}

void ASHGameMode::UpdatePickups(float Dt)
{
	if (!PlayerChar || bPlayerDead) return;
	const FVector PP = PlayerPos();
	for (FSHPickup& Pk : World->Pickups)
	{
		AActor* Vis = Pk.Visual.Get();
		if (!Vis) continue;
		if (Vis->IsHidden())
		{
			Pk.Respawn -= Dt;
			if (Pk.Respawn <= 0.f) Vis->SetActorHiddenInGame(false);
			continue;
		}
		if (FVector::Dist2D(Vis->GetActorLocation(), PP) > 220.f || FMath::Abs(Vis->GetActorLocation().Z - PP.Z) > 300.f) continue;
		if (Pk.Type != 1 && Pk.Type != 2 && PlayerVehicle) continue;
		if (Pk.Type == 1) { if (PlayerChar->Health >= 100.f) continue; PlayerChar->Health = 100.f; }
		else if (Pk.Type == 2) { if (PlayerChar->Armor >= 100.f) continue; PlayerChar->Armor = 100.f; }
		else { PlayerChar->GiveWeapon(Pk.Weapon); ShowHelp(FString::Printf(TEXT("Picked up: %s"), SHWeaponDef(Pk.Weapon).Name), 2.5f); }
		Vis->SetActorHiddenInGame(true);
		Pk.Respawn = 60.f;
	}
	for (int32 i = CashDrops.Num() - 1; i >= 0; --i)
	{
		ASHProp* C = CashDrops[i];
		if (!C || C->IsActorBeingDestroyed()) { CashDrops.RemoveAt(i); CashAmounts.RemoveAt(i); continue; }
		if (FVector::Dist2D(C->GetActorLocation(), PP) < 180.f && FMath::Abs(C->GetActorLocation().Z - PP.Z) < 300.f)
		{
			Money += CashAmounts[i];
			C->Destroy();
			CashDrops.RemoveAt(i); CashAmounts.RemoveAt(i);
		}
	}
}

// ---------------------------------------------------------------- vehicles
void ASHGameMode::TryEnterNearestVehicle()
{
	if (!PlayerChar || PlayerVehicle || bPlayerDead) return;
	ASHVehicle* Best = nullptr;
	float BestD = 550.f;
	for (ASHVehicle* V : Vehicles)
	{
		if (!V || V->bDead) continue;
		const float D = FVector::Dist2D(V->GetActorLocation(), PlayerChar->GetActorLocation()) - V->Def->Len * 30.f;
		if (D < BestD && FMath::Abs(V->GetActorLocation().Z - PlayerChar->GetActorLocation().Z) < 400.f) { BestD = D; Best = V; }
	}
	if (Best) EnterVehicle(Best);
}

void ASHGameMode::EnterVehicle(ASHVehicle* V, bool bQuiet)
{
	if (!PlayerChar || !V || V->bDead) return;
	APlayerController* PC = Cast<APlayerController>(PlayerChar->GetController());
	if (!PC) return;
	const bool bOccupied = V->Mode != ESHDriveMode::None && V->Mode != ESHDriveMode::Parked;
	if (bOccupied && !bQuiet)
	{
		if (!V->Def->bHeli)
		{
			FActorSpawnParameters SP;
			SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
			const FVector Door = V->DoorPoint();
			if (ASHPed* Driver = GetWorld()->SpawnActor<ASHPed>(ASHPed::StaticClass(), Door + FVector(0.f, 0.f, 60.f), FRotator::ZeroRotator, SP))
			{
				Driver->Init(V->Def->bPolice ? ESHPedKind::Cop : ESHPedKind::Civ, -1, World->CityAt(Door.X / SH::M, Door.Y / SH::M), FLinearColor::Red);
				Driver->Scare(V->GetActorLocation(), 15.f);
				Peds.Add(Driver);
			}
		}
		ReportCrime(V->Def->bPolice ? ESHCrime::StealCop : ESHCrime::Carjack, V->GetActorLocation());
	}
	else if (V->Def->bPolice && !bQuiet) ReportCrime(ESHCrime::StealCop, V->GetActorLocation());
	if (V->Kind == ESHVehicleKind::Tank && !bQuiet) ReportCrime(ESHCrime::Tank, V->GetActorLocation());
	PoliceUnits.Remove(V);
	if (World->ParkingSpots.IsValidIndex(V->ParkSpot)) { World->ParkingSpots[V->ParkSpot].Car = nullptr; World->ParkingSpots[V->ParkSpot].bCooldown = true; }
	if (World->Specials.IsValidIndex(V->SpecialSpot)) World->Specials[V->SpecialSpot].Car = nullptr;
	V->ParkSpot = -1; V->SpecialSpot = -1;
	V->Mode = ESHDriveMode::None;
	V->bPlayerDriven = true;
	V->bPersistent = true;
	V->Throttle = V->Steer = V->Lift = 0.f;
	if (V->Def->bHeli) V->RotorSpeed = FMath::Max(V->RotorSpeed, 0.3f);
	PlayerChar->SetHiddenForVehicle(true);
	PC->UnPossess();
	PC->Possess(V);
	PC->SetControlRotation(FRotator(V->Def->bHeli ? -18.f : -10.f, V->Yaw, 0.f));
	PlayerVehicle = V;
	++CarsStolen;
	ShowBig(V->Def->Name, SH::Hex(TEXT("FFD98A")), 2.f);
	switch (V->Kind)
	{
	case ESHVehicleKind::Tank: ShowHelp(TEXT("TANK: aim with the mouse, left click fires the cannon. Drive over cars to crush them.")); break;
	case ESHVehicleKind::Heli: ShowHelp(TEXT("HELICOPTER: Space climb, Shift descend, W/S tilt, A/D turn, left click fires rockets.")); break;
	case ESHVehicleKind::PoliceHeli: ShowHelp(TEXT("HELICOPTER: Space climb, Shift descend, W/S tilt, A/D turn.")); break;
	case ESHVehicleKind::Monster: ShowHelp(TEXT("MONSTER TRUCK: drive over cars to crush them. Shift for nitro.")); break;
	default: break;
	}
}

void ASHGameMode::ExitVehicle(bool bForce)
{
	ASHVehicle* V = PlayerVehicle;
	if (!V || !PlayerChar) return;
	APlayerController* PC = Cast<APlayerController>(V->GetController());
	const float Sp = V->SpeedMs();
	V->bPlayerDriven = false;
	V->Throttle = V->Steer = V->Lift = 0.f;
	V->bNitro = V->bFiring = false;
	V->bSiren = false;
	if (PC) PC->UnPossess();
	const FVector Door = V->DoorPoint();
	PlayerChar->SetActorLocation(Door + FVector(0.f, 0.f, 60.f));
	PlayerChar->SetActorRotation(FRotator(0.f, V->Yaw, 0.f));
	PlayerChar->SetHiddenForVehicle(false);
	if (PC)
	{
		PC->Possess(PlayerChar);
		PC->SetControlRotation(FRotator(-10.f, V->Yaw, 0.f));
	}
	PlayerVehicle = nullptr;
	if (V->Def->bHeli && !V->bGrounded)
	{
		PlayerChar->LaunchCharacter(V->Vel + FVector(0.f, 0.f, V->VelZ), true, true);
	}
	else if (Sp > 12.f && !bForce)
	{
		const FVector Side = (Door - V->GetActorLocation()).GetSafeNormal2D();
		PlayerChar->LaunchCharacter(V->Vel * 0.5f + Side * 400.f + FVector(0.f, 0.f, 300.f), true, true);
		PlayerChar->TakeHit(FMath::Min(30.f, Sp * 0.8f), true);
		ShowHelp(TEXT("You bailed out!"), 2.f);
	}
}

// ------------------------------------------------------------------ combat
FVector ASHGameMode::AimPoint(const FVector& CamLoc, const FVector& CamFwd, const AActor* Ignore) const
{
	FCollisionQueryParams Params(SCENE_QUERY_STAT(SHAim), false);
	if (Ignore) Params.AddIgnoredActor(Ignore);
	if (PlayerChar) Params.AddIgnoredActor(PlayerChar);
	if (PlayerVehicle) Params.AddIgnoredActor(PlayerVehicle);
	FCollisionObjectQueryParams Obj;
	Obj.AddObjectTypesToQuery(ECC_WorldStatic);
	Obj.AddObjectTypesToQuery(ECC_WorldDynamic);
	Obj.AddObjectTypesToQuery(ECC_Pawn);
	Obj.AddObjectTypesToQuery(ECC_Vehicle);
	const FVector Start = CamLoc + CamFwd * 150.f;
	const FVector End = CamLoc + CamFwd * 40000.f;
	FHitResult Hit;
	if (GetWorld()->LineTraceSingleByObjectType(Hit, Start, End, Obj, Params)) return Hit.ImpactPoint;
	return End;
}

void ASHGameMode::FireBullet(const FVector& Start, const FVector& Dir, float Damage, float RangeCm, AActor* Ignore, bool bByPlayer, bool bTracer)
{
	FCollisionQueryParams Params(SCENE_QUERY_STAT(SHBullet), false);
	if (Ignore) Params.AddIgnoredActor(Ignore);
	if (bByPlayer)
	{
		if (PlayerChar) Params.AddIgnoredActor(PlayerChar);
		if (PlayerVehicle) Params.AddIgnoredActor(PlayerVehicle);
	}
	FCollisionObjectQueryParams Obj;
	Obj.AddObjectTypesToQuery(ECC_WorldStatic);
	Obj.AddObjectTypesToQuery(ECC_WorldDynamic);
	Obj.AddObjectTypesToQuery(ECC_Pawn);
	Obj.AddObjectTypesToQuery(ECC_Vehicle);
	const FVector End = Start + Dir * RangeCm;
	FHitResult Hit;
	FVector HitPoint = End;
	if (GetWorld()->LineTraceSingleByObjectType(Hit, Start, End, Obj, Params))
	{
		HitPoint = Hit.ImpactPoint;
		AActor* A = Hit.GetActor();
		if (ASHPed* P = Cast<ASHPed>(A))
		{
			const bool bHead = Hit.ImpactPoint.Z > P->GetActorLocation().Z + 60.f;
			P->Hit(Damage * (bHead ? 3.f : 1.f), Dir, bByPlayer, bExplosiveAmmo ? 1500.f : 300.f);
		}
		else if (ASHVehicle* V = Cast<ASHVehicle>(A))
		{
			V->Damage(Damage * 1.2f, bByPlayer);
			SpawnPuff(HitPoint, FLinearColor(1.f, 0.8f, 0.3f), 0.3f, 0.15f);
			if (bByPlayer)
			{
				if (V->Def->bPolice) ReportCrime(ESHCrime::CopAssault, V->GetActorLocation());
				if (V->Mode == ESHDriveMode::Traffic) V->Panic = 8.f;
			}
			else if (V == PlayerVehicle && FMath::FRand() < 0.25f && PlayerChar) PlayerChar->TakeHit(Damage * 0.4f);
		}
		else if (ASHPlayerCharacter* PCh = Cast<ASHPlayerCharacter>(A))
		{
			if (!bByPlayer) PCh->TakeHit(Damage);
		}
		else SpawnPuff(HitPoint, FLinearColor(0.55f, 0.52f, 0.48f), 0.35f, 0.4f);
		if (bByPlayer && bExplosiveAmmo) Explode(HitPoint, 4.5f, true, nullptr);
	}
	if (bTracer) SpawnTracer(Start, HitPoint, bByPlayer ? FLinearColor(1.f, 0.85f, 0.5f) : FLinearColor(1.f, 0.45f, 0.35f));
}

void ASHGameMode::NpcShoot(const FVector& From, float Accuracy, float Damage, AActor* Shooter)
{
	if (bPlayerDead) return;
	const FVector Target = PlayerPos() + FVector(0.f, 0.f, PlayerVehicle ? 60.f : 40.f);
	const float Moving = PlayerVehicle ? PlayerVehicle->SpeedMs() : (PlayerChar ? PlayerChar->GetVelocity().Size2D() / SH::M : 0.f);
	const float Dist = FVector::Dist(From, Target) / SH::M;
	const float Miss = ((1.f - Accuracy) * (0.6f + Dist / 60.f) + Moving * 0.015f) * 300.f;
	const FVector Aim = Target + FVector(FMath::FRandRange(-Miss, Miss), FMath::FRandRange(-Miss, Miss), FMath::FRandRange(-Miss, Miss) * 0.6f);
	FireBullet(From, (Aim - From).GetSafeNormal(), Damage, 16000.f, Shooter, false, true);
}

void ASHGameMode::SpawnRocket(const FVector& From, const FVector& Dir, AActor* Shooter, bool bByPlayer, float SpeedCmS, float RadiusM)
{
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ASHRocket* R = GetWorld()->SpawnActor<ASHRocket>(ASHRocket::StaticClass(), From, Dir.Rotation(), P);
	if (!R) return;
	AddPart(R, R->Root, CylinderMesh, FVector::ZeroVector, FVector(0.2f, 0.2f, 0.9f), SH::Hex(TEXT("556B2F")), FRotator(90.f, 0.f, 0.f));
	AddPart(R, R->Root, SphereMesh, FVector(-50.f, 0.f, 0.f), FVector(0.35f, 0.35f, 0.35f), SH::Hex(TEXT("FFB040")));
	R->Velocity = Dir * SpeedCmS;
	R->Shooter = Shooter;
	R->bByPlayer = bByPlayer;
	R->RadiusM = RadiusM;
	R->Gravity = SpeedCmS > 12000.f ? 400.f : 0.f;
	if (bByPlayer) OnPlayerGunfire(From);
}

void ASHGameMode::Explode(const FVector& At, float RadiusM, bool bByPlayer, AActor* Ignore)
{
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	if (ASHProp* Fire = GetWorld()->SpawnActor<ASHProp>(ASHProp::StaticClass(), At, FRotator::ZeroRotator, SP))
	{
		AddPart(Fire, Fire->Root, SphereMesh, FVector::ZeroVector, FVector(RadiusM * 0.35f), SH::Hex(TEXT("FF9A2A")));
		AddPart(Fire, Fire->Root, SphereMesh, FVector(0.f, 0.f, 60.f), FVector(RadiusM * 0.22f), SH::Hex(TEXT("FFE680")));
		Fire->AddLight(FLinearColor(1.f, 0.6f, 0.25f), 400000.f, RadiusM * 400.f);
		Fire->Grow = 2.5f;
		Fire->Life = 0.45f;
	}
	for (int32 i = 0; i < 6; ++i)
		SpawnPuff(At + FVector(FMath::FRandRange(-300.f, 300.f), FMath::FRandRange(-300.f, 300.f), FMath::FRandRange(0.f, 300.f)), FLinearColor(0.12f, 0.11f, 0.1f), RadiusM * 0.3f, FMath::FRandRange(1.5f, 3.f));
	const float R = RadiusM * SH::M;
	for (ASHVehicle* V : TArray<TObjectPtr<ASHVehicle>>(Vehicles))
	{
		if (!V || V == Ignore) continue;
		const FVector D = V->GetActorLocation() - At;
		const float Dist = D.Size();
		const float Reach = R + V->Def->Len * 50.f;
		if (Dist > Reach) continue;
		const float F = FMath::Clamp(1.f - Dist / Reach, 0.1f, 1.f);
		const float Push = 1400.f * F / FMath::Sqrt(V->Def->Mass);
		V->Vel += D.GetSafeNormal2D() * Push;
		if (!V->Def->bHeli) { V->VelZ += 900.f * F / FMath::Sqrt(V->Def->Mass); V->bGrounded = false; }
		if (bByPlayer) V->bLastHitByPlayer = true;
		V->Damage(1800.f * F * RadiusM / 9.f, bByPlayer, true);
	}
	for (ASHPed* P : TArray<TObjectPtr<ASHPed>>(Peds))
	{
		if (!P || P->State == ESHPedState::Dead) continue;
		const FVector D = P->GetActorLocation() - At;
		const float Dist = D.Size2D();
		if (Dist > R) { if (Dist < 6000.f) P->Scare(At, 10.f); continue; }
		const float F = 1.f - Dist / R;
		P->Hit(200.f * F + 40.f, D.GetSafeNormal2D(), bByPlayer, 1600.f * F + 500.f);
	}
	if (PlayerChar && !PlayerVehicle && !bPlayerDead)
	{
		const FVector D = PlayerChar->GetActorLocation() - At;
		const float Dist = D.Size();
		if (Dist < R)
		{
			const float F = 1.f - Dist / R;
			PlayerChar->TakeHit(130.f * F);
			PlayerChar->LaunchCharacter(D.GetSafeNormal2D() * 1200.f * F + FVector(0.f, 0.f, 600.f * F), true, true);
		}
	}
	if (bByPlayer) ReportCrime(ESHCrime::Explosion, At);
}

void ASHGameMode::PunchFrom(AActor* Puncher, const FVector& At, const FVector& Fwd)
{
	for (ASHPed* P : Peds)
	{
		if (!P || !P->IsAlive()) continue;
		const FVector D = P->GetActorLocation() - At;
		const float Dist = D.Size2D();
		if (Dist < 190.f && FVector::DotProduct(D.GetSafeNormal2D(), Fwd) > 0.3f)
			P->Hit(bExplosiveAmmo ? 100.f : 20.f, Fwd, true, bExplosiveAmmo ? 2500.f : 400.f);
	}
}

void ASHGameMode::SpawnPuff(const FVector& At, const FLinearColor& Color, float SizeM, float Life)
{
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	if (ASHProp* P = GetWorld()->SpawnActor<ASHProp>(ASHProp::StaticClass(), At, FRotator::ZeroRotator, SP))
	{
		AddPart(P, P->Root, SphereMesh, FVector::ZeroVector, FVector(SizeM), Color);
		P->Life = Life;
		P->Grow = 1.2f / FMath::Max(0.1f, Life);
	}
}

void ASHGameMode::SpawnBlood(const FVector& At) { SpawnPuff(At, FLinearColor(0.5f, 0.02f, 0.02f), 0.35f, 0.35f); }

void ASHGameMode::SpawnTracer(const FVector& A, const FVector& B, const FLinearColor& Color)
{
	const FVector D = B - A;
	const float Len = D.Size();
	if (Len < 10.f) return;
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	if (ASHProp* P = GetWorld()->SpawnActor<ASHProp>(ASHProp::StaticClass(), (A + B) * 0.5f, D.Rotation(), SP))
	{
		AddPart(P, P->Root, CubeMesh, FVector::ZeroVector, FVector(Len / SH::M, 0.03f, 0.03f), Color);
		P->Life = 0.06f;
	}
}

void ASHGameMode::RunOver(ASHVehicle* V)
{
	const float Sp = V->SpeedMs();
	if (V->Def->bHeli && !V->bGrounded) return;
	const FVector F = V->Forward();
	const float HalfL = V->Def->Len * 50.f + 40.f, HalfW = V->Def->Wid * 50.f + 40.f;
	auto Inside = [&](const FVector& P)
	{
		const FVector D = P - V->GetActorLocation();
		if (FMath::Abs(D.Z) > V->Def->Hgt * SH::M + 100.f) return false;
		const float Along = D.X * F.X + D.Y * F.Y, Side = -D.X * F.Y + D.Y * F.X;
		return FMath::Abs(Along) < HalfL && FMath::Abs(Side) < HalfW;
	};
	for (ASHPed* P : TArray<TObjectPtr<ASHPed>>(Peds))
	{
		if (!P || !P->IsAlive() || P->State == ESHPedState::Knocked) continue;
		if (FVector::DistSquared2D(P->GetActorLocation(), V->GetActorLocation()) > 1000.f * 1000.f) continue;
		if (!Inside(P->GetActorLocation())) continue;
		const FVector Dir = V->Vel.GetSafeNormal2D();
		P->Hit(Sp * 7.f * (V->Def->bCrusher ? 3.f : 1.f), Dir, V->bPlayerDriven, 0.f);
		if (P->State != ESHPedState::Dead) P->Knock(V->Vel * 1.1f + FVector(0.f, 0.f, 300.f + Sp * 25.f));
		if (V->Mode == ESHDriveMode::Traffic) V->Panic = 6.f;
	}
	if (PlayerChar && !PlayerVehicle && !bPlayerDead && !V->bPlayerDriven && Inside(PlayerChar->GetActorLocation()))
	{
		PlayerChar->TakeHit(Sp * 3.5f);
		PlayerChar->LaunchCharacter(V->Vel * 0.9f + FVector(0.f, 0.f, 400.f + Sp * 15.f), true, true);
	}
}

// ------------------------------------------------------------------ events
void ASHGameMode::OnPlayerGunfire(const FVector& At)
{
	ReportCrime(ESHCrime::Gunfire, At);
	for (ASHPed* P : Peds)
	{
		if (!P) continue;
		const float D = FVector::Dist2D(P->GetActorLocation(), At) / SH::M;
		if (D < 45.f) P->Scare(At, 10.f);
		if (P->Kind == ESHPedKind::Gang && D < 30.f) P->bHostile = true;
	}
	for (ASHVehicle* V : Vehicles)
		if (V && V->Mode == ESHDriveMode::Traffic && FVector::Dist2D(V->GetActorLocation(), At) < 4000.f) V->Panic = 6.f;
}

void ASHGameMode::OnPlayerHurtPed(ASHPed* P, bool bKilled)
{
	const bool bCop = P->Kind == ESHPedKind::Cop || P->Kind == ESHPedKind::Swat;
	ReportCrime(bKilled ? (bCop ? ESHCrime::CopKill : ESHCrime::Murder) : (bCop ? ESHCrime::CopAssault : ESHCrime::Assault), P->GetActorLocation());
}

void ASHGameMode::OnPedKilled(ASHPed* P, bool bByPlayer)
{
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	if (ASHProp* Cash = GetWorld()->SpawnActor<ASHProp>(ASHProp::StaticClass(), P->GetActorLocation() + FVector(FMath::FRandRange(-60.f, 60.f), FMath::FRandRange(-60.f, 60.f), -60.f), FRotator::ZeroRotator, SP))
	{
		AddPart(Cash, Cash->Root, CubeMesh, FVector::ZeroVector, FVector(0.35f, 0.2f, 0.12f), SH::Hex(TEXT("5FDC5F")));
		Cash->Spin = 180.f;
		Cash->Life = 30.f;
		CashDrops.Add(Cash);
		CashAmounts.Add(P->Cash);
	}
	if (bByPlayer)
	{
		++Kills;
		if (Active >= 0 && Missions[Active].Id == 2 && Stage == 1) ++MissionCount;
	}
}

void ASHGameMode::OnVehicleDestroyed(ASHVehicle* V)
{
	if (V == PlayerVehicle)
	{
		ExitVehicle(true);
		if (PlayerChar && !bGodMode) PlayerChar->TakeHit(999.f);
	}
	if (V->bLastHitByPlayer) ReportCrime(V->Def->bPolice ? ESHCrime::CopKill : ESHCrime::VehicleKill, V->GetActorLocation());
}

void ASHGameMode::OnVehicleSunk(ASHVehicle* V)
{
	if (V == PlayerVehicle)
	{
		ExitVehicle(true);
		ShowHelp(TEXT("Your ride is sleeping with the fishes."), 3.f);
	}
}

void ASHGameMode::OnVehicleCrash(ASHVehicle* V, float ImpactMs, const FVector& At)
{
	SpawnPuff(At, FLinearColor(1.f, 0.8f, 0.3f), 0.25f + ImpactMs * 0.01f, 0.2f);
}

void ASHGameMode::OnVehicleCollision(ASHVehicle* A, ASHVehicle* B, float SpeedMs)
{
	SpawnPuff((A->GetActorLocation() + B->GetActorLocation()) * 0.5f, FLinearColor(1.f, 0.8f, 0.3f), 0.4f, 0.2f);
	ASHVehicle* Other = A == PlayerVehicle ? B : B == PlayerVehicle ? A : nullptr;
	if (!Other) return;
	if (Other->Def->bPolice && SpeedMs > 7.f) ReportCrime(ESHCrime::CopAssault, Other->GetActorLocation());
	if (Other->Mode == ESHDriveMode::Traffic) Other->Panic = 8.f;
}

void ASHGameMode::OnCrush(ASHVehicle* Victim, ASHVehicle* By)
{
	SpawnPuff(Victim->GetActorLocation(), FLinearColor(1.f, 0.8f, 0.3f), 1.f, 0.3f);
	if (By && By->bPlayerDriven)
	{
		if (Active >= 0 && Missions[Active].Id == 3 && Stage == 1) ++MissionCount;
		if (Victim->Def->bPolice) ReportCrime(ESHCrime::CopAssault, Victim->GetActorLocation());
	}
}

void ASHGameMode::OnPlayerLanded(ASHVehicle* V, float ImpactMs)
{
	if (V->AirTime > 0.8f && V->MaxAir > 3.f)
	{
		const int32 Bonus = FMath::FloorToInt(V->AirTime * V->MaxAir * 25.f);
		const bool bInsane = V->AirTime > 1.8f || V->MaxAir > 12.f;
		Money += Bonus;
		++Stunts;
		StuntText = bInsane ? TEXT("INSANE STUNT BONUS!") : TEXT("STUNT BONUS");
		StuntSub = FString::Printf(TEXT("%.1fs air  -  %dm high  -  +$%d"), V->AirTime, FMath::RoundToInt(V->MaxAir), Bonus);
		StuntTimer = 2.5f;
	}
	V->AirTime = 0.f;
	V->MaxAir = 0.f;
}

void ASHGameMode::PlayerDied()
{
	if (bPlayerDead) return;
	bPlayerDead = true;
	if (PlayerVehicle) ExitVehicle(true);
	if (PlayerChar) PlayerChar->Rig.LieDown();
	ShowBig(TEXT("WASTED"), SH::Hex(TEXT("C83232")), 5.f);
	RespawnTimer = 5.f;
	bRespawnAtPolice = false;
	if (Active >= 0) EndMission(false, TEXT("You died"));
}

void ASHGameMode::Busted()
{
	if (bPlayerDead) return;
	bPlayerDead = true;
	BustAccum = 0.f;
	ShowBig(TEXT("BUSTED"), SH::Hex(TEXT("4A8CFF")), 5.f);
	RespawnTimer = 5.f;
	bRespawnAtPolice = true;
	if (Active >= 0) EndMission(false, TEXT("You got busted"));
}

void ASHGameMode::TryBust(float Dt)
{
	if (bPlayerDead || PlayerVehicle || !PlayerChar) return;
	BustAccum += Dt * (PlayerChar->GetVelocity().Size2D() < 250.f ? 1.f : 0.35f);
	BustSeen = GetWorld()->GetTimeSeconds();
	if (BustAccum > 1.4f) Busted();
	else ShowHint(TEXT("Cops are arresting you! Move!"));
}

void ASHGameMode::Respawn()
{
	if (!PlayerChar) return;
	const TArray<FVector2D>& List = bRespawnAtPolice ? World->PoliceStations : World->Hospitals;
	const FVector PP = PlayerPos();
	FVector2D Best = List.Num() ? List[0] : FVector2D(-2200.f, -600.f);
	for (const FVector2D& S : List) if (FVector2D::Distance(S, FVector2D(PP) / SH::M) < FVector2D::Distance(Best, FVector2D(PP) / SH::M)) Best = S;
	const int32 Fee = bRespawnAtPolice ? 1000 : 500;
	Money = FMath::Max<int64>(0, Money - Fee);
	if (bRespawnAtPolice)
		for (int32 W = 2; W < (int32)ESHWeapon::Count; ++W) PlayerChar->Ammo[W] /= 2;
	ClearWanted();
	for (ASHPed* P : TArray<TObjectPtr<ASHPed>>(Peds))
		if (P && (P->Kind == ESHPedKind::Cop || P->Kind == ESHPedKind::Swat || P->bHostile)) { Peds.Remove(P); P->Destroy(); }
	bPlayerDead = false;
	PlayerChar->Health = 100.f;
	PlayerChar->Armor = 0.f;
	PlayerChar->Rig.StandUp();
	PlayerChar->SetActorLocation(SH::W(Best.X, Best.Y, 1.5f));
	PlayerChar->GetCharacterMovement()->Velocity = FVector::ZeroVector;
	ShowHelp(bRespawnAtPolice ? FString::Printf(TEXT("You were released on bail. -$%d"), Fee) : FString::Printf(TEXT("Hospital bill: -$%d"), Fee), 4.f);
}

// ------------------------------------------------------------------ wanted
void ASHGameMode::ReportCrime(ESHCrime Crime, const FVector& At)
{
	if (bWantedLocked || bNeverWanted) return;
	const bool bInCity = World->CityAt(At.X / SH::M, At.Y / SH::M, 60.f) >= 0;
	const int32 Before = WantedLevel;
	switch (Crime)
	{
	case ESHCrime::Gunfire: if (bInCity) WantedLevel = FMath::Max(WantedLevel, 1); break;
	case ESHCrime::Assault: case ESHCrime::Carjack: WantedLevel = FMath::Max(WantedLevel, 1); break;
	case ESHCrime::Murder: ++WantedKills; WantedLevel = FMath::Max(WantedLevel, 2); if (WantedKills % 4 == 0) ++WantedLevel; break;
	case ESHCrime::CopKill: WantedLevel = FMath::Max(WantedLevel + 1, 3); break;
	case ESHCrime::CopAssault: case ESHCrime::StealCop: case ESHCrime::VehicleKill: WantedLevel = FMath::Max(WantedLevel, 2); break;
	case ESHCrime::Explosion: if (bInCity) WantedLevel = FMath::Max(WantedLevel, 2); break;
	case ESHCrime::Tank: case ESHCrime::Heist: WantedLevel = FMath::Max(WantedLevel, 4); break;
	}
	WantedLevel = FMath::Clamp(WantedLevel, 0, 5);
	if (WantedLevel > Before) { SearchTimer = 0.f; bWantedSeen = true; }
}

void ASHGameMode::SetWanted(int32 Level)
{
	WantedLevel = FMath::Clamp(Level, 0, 5);
	SearchTimer = 0.f;
	if (WantedLevel == 0) ClearWanted();
}

void ASHGameMode::ClearWanted()
{
	WantedLevel = 0;
	WantedKills = 0;
	for (ASHVehicle* V : PoliceUnits)
	{
		if (!V || V->bDead) continue;
		V->bSiren = false;
		if (V->Def->bHeli) V->Mode = ESHDriveMode::HeliPatrol;
		else if (V->Mode == ESHDriveMode::Chase) { V->Mode = ESHDriveMode::Traffic; V->EdgeId = -1; }
	}
	PoliceUnits.RemoveAll([](const TObjectPtr<ASHVehicle>& V) { return !V || !V->Def->bHeli; });
	for (ASHPed* P : Peds) if (P && (P->Kind == ESHPedKind::Cop || P->Kind == ESHPedKind::Swat) && P->State == ESHPedState::Attack) P->State = ESHPedState::Idle;
}

ASHVehicle* ASHGameMode::SpawnPoliceCar(ESHVehicleKind Kind)
{
	const FVector PP = PlayerPos();
	for (int32 Try = 0; Try < 30; ++Try)
	{
		const int32 E = FMath::RandRange(0, World->Edges.Num() - 1);
		const FSHRoadEdge& Ed = World->Edges[E];
		const float T = FMath::FRand();
		const FVector2D P = FMath::Lerp(World->Nodes[Ed.A].P, World->Nodes[Ed.B].P, T);
		const float D = FVector2D::Distance(P, FVector2D(PP) / SH::M);
		if (D < 110.f || D > 260.f) continue;
		ASHVehicle* V = SpawnVehicle(Kind, P, 0.f, 0.f, Kind == ESHVehicleKind::Van ? SH::Hex(TEXT("111111")) : FLinearColor(0.f, 0.f, 0.f, -1.f));
		if (!V) return nullptr;
		const int32 From = FMath::RandBool() ? Ed.A : Ed.B;
		V->PlaceOnEdge(E, From, From == Ed.A ? T : 1.f - T);
		V->Mode = ESHDriveMode::Chase;
		V->bSiren = true;
		V->bSwat = Kind == ESHVehicleKind::Van;
		if (Kind == ESHVehicleKind::Tank) ShowBig(TEXT("THE MILITARY IS HERE"), SH::Hex(TEXT("FF4040")), 2.5f);
		PoliceUnits.Add(V);
		return V;
	}
	return nullptr;
}

void ASHGameMode::UpdateWanted(float Dt)
{
	PoliceUnits.RemoveAll([](const TObjectPtr<ASHVehicle>& V) { return !V || (V->bDead && V->WreckTimer > 5.f); });
	const FVector PP = PlayerPos();
	if (WantedLevel == 0)
	{
		for (ASHVehicle* V : TArray<TObjectPtr<ASHVehicle>>(PoliceUnits))
			if (V && V->Def->bHeli && FVector::Dist2D(V->GetActorLocation(), PP) > 40000.f) { PoliceUnits.Remove(V); Vehicles.Remove(V); V->Destroy(); }
		return;
	}
	if (bPlayerDead) return;
	bool bSeen = false;
	for (ASHVehicle* V : PoliceUnits)
	{
		if (!V || V->bDead) continue;
		const float D = FVector::Dist2D(V->GetActorLocation(), PP) / SH::M;
		const float Range = V->Def->bHeli ? 160.f : 110.f;
		if (D < Range && (D < 25.f || World->LineOfSight(V->GetActorLocation() + FVector(0.f, 0.f, 150.f), PP + FVector(0.f, 0.f, 100.f), V, PlayerVehicle))) { bSeen = true; break; }
	}
	if (!bSeen)
		for (ASHPed* P : Peds)
			if (P && P->IsAlive() && (P->Kind == ESHPedKind::Cop || P->Kind == ESHPedKind::Swat) && FVector::Dist2D(P->GetActorLocation(), PP) < 5000.f) { bSeen = true; break; }
	bWantedSeen = bSeen;
	if (bSeen) SearchTimer = 0.f;
	else
	{
		SearchTimer += Dt;
		if (SearchTimer > 7.f + WantedLevel * 3.f)
		{
			ClearWanted();
			ShowBig(TEXT("LOST THE COPS"), SH::Hex(TEXT("7FFF7F")), 2.5f);
			return;
		}
	}
	WantedSpawnCd -= Dt;
	if (WantedSpawnCd <= 0.f)
	{
		WantedSpawnCd = 1.5f;
		static const int32 CarsFor[] = { 0, 2, 3, 5, 6, 8 };
		int32 Cars = 0, Helis = 0;
		bool bTank = false;
		for (ASHVehicle* V : PoliceUnits)
		{
			if (!V || V->bDead) continue;
			if (V->Def->bHeli) ++Helis; else ++Cars;
			if (V->Kind == ESHVehicleKind::Tank) bTank = true;
		}
		if (Cars < CarsFor[WantedLevel])
			SpawnPoliceCar(WantedLevel >= 5 && !bTank ? ESHVehicleKind::Tank : (WantedLevel >= 4 && SH::Chance(0.35f)) ? ESHVehicleKind::Van : ESHVehicleKind::Police);
		const int32 WantHelis = WantedLevel >= 5 ? 2 : WantedLevel >= 3 ? 1 : 0;
		if (Helis < WantHelis)
		{
			const float A = FMath::FRandRange(0.f, 2.f * PI);
			ASHVehicle* H = SpawnVehicle(ESHVehicleKind::PoliceHeli, FVector2D(PP) / SH::M + FVector2D(FMath::Cos(A), FMath::Sin(A)) * 250.f, 0.f, 90.f);
			if (H) { H->Mode = ESHDriveMode::HeliPatrol; PoliceUnits.Add(H); }
		}
		// recruit nearby patrol cars
		for (ASHVehicle* V : Vehicles)
			if (V && V->Def->bPolice && !V->Def->bHeli && V->Mode == ESHDriveMode::Traffic && !V->bDead && FVector::Dist2D(V->GetActorLocation(), PP) < 20000.f)
			{
				V->Mode = ESHDriveMode::Chase;
				PoliceUnits.AddUnique(V);
			}
		// officers get back in their cars when you drive off
		if (PlayerVehicle)
			for (ASHVehicle* V : PoliceUnits)
			{
				if (!V || V->bDead || V->Def->bHeli || V->Mode == ESHDriveMode::Chase) continue;
				if (FVector::Dist2D(V->GetActorLocation(), PP) < 3000.f) continue;
				int32 Boarded = 0;
				for (ASHPed* P : TArray<TObjectPtr<ASHPed>>(Peds))
					if (P && P->IsAlive() && (P->Kind == ESHPedKind::Cop || P->Kind == ESHPedKind::Swat) && FVector::Dist2D(P->GetActorLocation(), V->GetActorLocation()) < 3000.f && Boarded < 4)
					{
						Peds.Remove(P); P->Destroy(); ++Boarded;
					}
				if (Boarded) { V->Mode = ESHDriveMode::Chase; V->bCopsOut = false; V->bSiren = true; }
			}
	}
	for (ASHVehicle* V : TArray<TObjectPtr<ASHVehicle>>(PoliceUnits))
		if (V && !V->Def->bHeli && FVector::Dist2D(V->GetActorLocation(), PP) > 52000.f) { PoliceUnits.Remove(V); Vehicles.Remove(V); V->Destroy(); }
}

void ASHGameMode::SpawnCopsFromCar(ASHVehicle* V)
{
	int32 OnFoot = 0;
	for (ASHPed* P : Peds) if (P && P->IsAlive() && (P->Kind == ESHPedKind::Cop || P->Kind == ESHPedKind::Swat)) ++OnFoot;
	const int32 N = FMath::Min(V->bSwat ? 4 : 2, FMath::Max(0, 2 + WantedLevel * 2 - OnFoot));
	const FVector F = V->Forward();
	for (int32 i = 0; i < N; ++i)
	{
		const float Side = (i % 2) ? 1.f : -1.f;
		const FVector Loc = V->GetActorLocation() + FVector(-F.Y, F.X, 0.f) * Side * 220.f - F * (i > 1 ? 200.f : 0.f) + FVector(0.f, 0.f, 60.f);
		FActorSpawnParameters SP;
		SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
		if (ASHPed* C = GetWorld()->SpawnActor<ASHPed>(ASHPed::StaticClass(), Loc, FRotator::ZeroRotator, SP))
		{
			C->Init(V->bSwat ? ESHPedKind::Swat : ESHPedKind::Cop, -1, 0, FLinearColor::Blue);
			C->State = ESHPedState::Attack;
			Peds.Add(C);
		}
	}
	V->Mode = ESHDriveMode::Parked;
}

// ------------------------------------------------------------------ cheats
bool ASHGameMode::ApplyCheat(const FString& InCode)
{
	const FString Code = InCode.ToUpper().TrimStartAndEnd();
	auto Near = [&](ESHVehicleKind K)
	{
		const FVector PP = PlayerPos();
		const float Yaw = PlayerVehicle ? PlayerVehicle->Yaw : (PlayerChar ? PlayerChar->GetActorRotation().Yaw : 0.f);
		const FVector P = PP + FRotator(0.f, Yaw, 0.f).Vector() * 900.f;
		ASHVehicle* V = SpawnVehicle(K, FVector2D(P) / SH::M, Yaw);
		if (V) { V->bPersistent = true; if (V->Def->bHeli) V->RotorSpeed = 1.f; }
	};
	FString Msg;
	if (Code == TEXT("HESOYAM")) { if (PlayerChar) { PlayerChar->Health = 100.f; PlayerChar->Armor = 100.f; } Money += 250000; if (PlayerVehicle) { PlayerVehicle->Health = PlayerVehicle->MaxHealth; PlayerVehicle->bOnFire = false; } Msg = TEXT("Health, armor, $250k"); }
	else if (Code == TEXT("TURTLE")) { if (PlayerChar) { PlayerChar->Health = 100.f; PlayerChar->Armor = 100.f; } Msg = TEXT("Max health & armor"); }
	else if (Code == TEXT("PAINKILLER")) { bGodMode = !bGodMode; Msg = bGodMode ? TEXT("Invincibility ON") : TEXT("Invincibility OFF"); }
	else if (Code == TEXT("TOOLUP")) { if (PlayerChar) { for (int32 W = 1; W < (int32)ESHWeapon::Count; ++W) PlayerChar->GiveWeapon((ESHWeapon)W); PlayerChar->Weapon = ESHWeapon::RPG; } Msg = TEXT("All weapons"); }
	else if (Code == TEXT("FULLCLIP")) { bInfiniteAmmo = !bInfiniteAmmo; Msg = bInfiniteAmmo ? TEXT("Infinite ammo ON") : TEXT("Infinite ammo OFF"); }
	else if (Code == TEXT("LAWYERUP")) { SetWanted(0); Msg = TEXT("Wanted level cleared"); }
	else if (Code == TEXT("FUGITIVE")) { bWantedLocked = false; SetWanted(WantedLevel + 1); Msg = TEXT("Wanted level raised"); }
	else if (Code == TEXT("LEAVEMEALONE")) { bNeverWanted = !bNeverWanted; if (bNeverWanted) SetWanted(0); Msg = bNeverWanted ? TEXT("Never wanted ON") : TEXT("Never wanted OFF"); }
	else if (Code == TEXT("SKYFALL")) { if (PlayerVehicle) ExitVehicle(true); if (PlayerChar) { PlayerChar->SetActorLocation(PlayerChar->GetActorLocation() + FVector(0.f, 0.f, 80000.f)); PlayerChar->GetCharacterMovement()->SetMovementMode(MOVE_Falling); } Msg = TEXT("Skyfall - press SPACE for your parachute"); }
	else if (Code == TEXT("COMET")) { Near(ESHVehicleKind::Sports); Msg = TEXT("Comet X"); }
	else if (Code == TEXT("BUZZOFF")) { Near(ESHVehicleKind::Heli); Msg = TEXT("Hornet attack helicopter"); }
	else if (Code == TEXT("RHINO")) { Near(ESHVehicleKind::Tank); Msg = TEXT("Tank"); }
	else if (Code == TEXT("MONSTER")) { Near(ESHVehicleKind::Monster); Msg = TEXT("Mardi Monster"); }
	else if (Code == TEXT("ROCKET")) { Near(ESHVehicleKind::Bike); Msg = TEXT("Hellcat 1000 bike"); }
	else if (Code == TEXT("CATCHME")) { bFastRun = !bFastRun; Msg = bFastRun ? TEXT("Fast run ON") : TEXT("Fast run OFF"); }
	else if (Code == TEXT("HOPTOIT")) { bSuperJump = !bSuperJump; Msg = bSuperJump ? TEXT("Super jump ON") : TEXT("Super jump OFF"); }
	else if (Code == TEXT("SLOWMO")) { bSlowMo = !bSlowMo; Msg = bSlowMo ? TEXT("Slow motion ON") : TEXT("Slow motion OFF"); }
	else if (Code == TEXT("TIMEWARP")) { Hour = FMath::Fmod(Hour + 6.f, 24.f); Msg = TEXT("Skipped 6 hours"); }
	else if (Code == TEXT("TIMELAPSE")) { bTimelapse = !bTimelapse; Msg = bTimelapse ? TEXT("Timelapse ON") : TEXT("Timelapse OFF"); }
	else if (Code == TEXT("HIGHEX") || Code == TEXT("HOTHANDS")) { bExplosiveAmmo = !bExplosiveAmmo; Msg = bExplosiveAmmo ? TEXT("Explosive bullets & punches ON") : TEXT("Explosive bullets & punches OFF"); }
	else if (Code == TEXT("SPEEDFREAK")) { bFastCars = !bFastCars; Msg = bFastCars ? TEXT("Turbo vehicles ON") : TEXT("Turbo vehicles OFF"); }
	else if (Code == TEXT("RIOT")) { for (ASHPed* P : Peds) if (P && P->IsAlive() && P->Kind == ESHPedKind::Civ) { P->Kind = ESHPedKind::Gang; P->bHostile = true; } Msg = TEXT("Riot mode"); }
	else if (Code == TEXT("ARMAGEDDON")) { Armageddon = 20.f; Msg = TEXT("ARMAGEDDON. Good luck."); }
	else { ShowHelp(FString::Printf(TEXT("Unknown cheat: %s"), *Code), 2.5f); return false; }
	ShowHelp(FString::Printf(TEXT("Cheat activated: %s"), *Msg), 3.f);
	return true;
}

// ---------------------------------------------------------------- missions
void ASHGameMode::SetupMissions()
{
	auto Add = [&](int32 Id, TCHAR Letter, const TCHAR* Title, const TCHAR* City, const TCHAR* Desc, FVector2D Marker, int32 Reward, const FLinearColor& Col)
	{
		FSHMission M;
		M.Id = Id; M.Letter = Letter; M.Title = Title; M.City = City; M.Desc = Desc; M.Marker = Marker; M.Reward = Reward; M.Color = Col;
		Missions.Add(M);
	};
	Add(0, 'R', TEXT("Big D Street Race"), TEXT("DALLAS"), TEXT("Four cars. One lap of Downtown Dallas. No rules."), BlockPos(DALLAS.X, DALLAS.Y, 2, 6) + FVector2D(0, 39), 15000, SH::Hex(TEXT("FFCF33")));
	Add(1, 'E', TEXT("Bayou Express"), TEXT("NEW ORLEANS"), TEXT("A van full of gumbo needs to be in Atlanta. Yesterday."), BlockPos(NOLA.X, NOLA.Y, 1, 6) + FVector2D(0, -39), 12000, SH::Hex(TEXT("8FD16A")));
	Add(2, 'K', TEXT("Peach State Rampage"), TEXT("ATLANTA"), TEXT("Take the minigun. The Old Fourth Ward crew started it."), BlockPos(ATL.X, ATL.Y, 3, 6) + FVector2D(0, 39), 20000, SH::Hex(TEXT("FF4D4D")));
	Add(3, 'M', TEXT("Mardi Gras Monster Mash"), TEXT("NEW ORLEANS"), TEXT("Crush cars with a monster truck. Laissez les bons temps rouler!"), BlockPos(NOLA.X, NOLA.Y, 6, 1) + FVector2D(0, -39), 15000, SH::Hex(TEXT("B48CFF")));
	Add(4, 'H', TEXT("The Big D Heist"), TEXT("DALLAS"), TEXT("Rob the Federal Reserve of Dallas and get the cash to the New Orleans safehouse."), World->Bank - FVector2D(0, 4), 250000, SH::Hex(TEXT("3DFF6A")));
	const FVector2D AtlSafe = World->Safehouses.IsValidIndex(2) ? World->Safehouses[2] : ATL;
	Add(5, 'S', TEXT("Skyfall Over The A"), TEXT("ATLANTA"), TEXT("Fly the Hornet to 500m, bail out, and parachute onto the Capitol lawn."), AtlSafe + FVector2D(8, 4), 20000, SH::Hex(TEXT("4DE1FF")));

	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	for (const FSHMission& M : Missions)
	{
		ASHProp* Prop = GetWorld()->SpawnActor<ASHProp>(ASHProp::StaticClass(), SH::W(M.Marker.X, M.Marker.Y, 0.3f), FRotator::ZeroRotator, SP);
		AddPart(Prop, Prop->Root, CylinderMesh, FVector(0.f, 0.f, 5.f), FVector(4.4f, 4.4f, 0.1f), M.Color);
		for (int32 K = 0; K < 8; ++K)
		{
			const float A = K / 8.f * 2.f * PI;
			AddPart(Prop, Prop->Root, CylinderMesh, FVector(FMath::Cos(A) * 210.f, FMath::Sin(A) * 210.f, 150.f), FVector(0.12f, 0.12f, 3.f), M.Color);
		}
		UTextRenderComponent* T = NewObject<UTextRenderComponent>(Prop);
		T->SetupAttachment(Prop->Root);
		T->SetText(FText::FromString(FString(1, &M.Letter)));
		T->SetTextRenderColor(M.Color.ToFColor(true));
		T->SetWorldSize(200.f);
		T->SetHorizontalAlignment(EHTA_Center);
		T->SetVerticalAlignment(EVRTA_TextCenter);
		T->SetRelativeLocation(FVector(0.f, 0.f, 420.f));
		T->RegisterComponent();
		Prop->AddInstanceComponent(T);
		Prop->Spin = 60.f;
		MarkerProps.Add(Prop);
	}
	CheckpointProp = GetWorld()->SpawnActor<ASHProp>(ASHProp::StaticClass(), FVector::ZeroVector, FRotator::ZeroRotator, SP);
	for (int32 K = 0; K < 16; ++K)
	{
		const float A = K / 16.f * 2.f * PI;
		AddPart(CheckpointProp, CheckpointProp->Root, CylinderMesh, FVector(FMath::Cos(A) * 600.f, FMath::Sin(A) * 600.f, 400.f), FVector(0.4f, 0.4f, 8.f), SH::Hex(TEXT("FFCF33")));
	}
	CheckpointProp->Spin = 40.f;
	CheckpointProp->SetActorHiddenInGame(true);
}

void ASHGameMode::SetCheckpoint(const FVector2D& P, float RadiusM)
{
	CheckpointProp->SetActorLocation(SH::W(P.X, P.Y, 0.f));
	CheckpointProp->SetActorScale3D(FVector(RadiusM / 6.f, RadiusM / 6.f, 1.f));
	CheckpointProp->SetActorHiddenInGame(false);
	bHasGps = true;
	Gps = P;
}

void ASHGameMode::ClearCheckpoint()
{
	CheckpointProp->SetActorHiddenInGame(true);
	bHasGps = false;
}

int32 ASHGameMode::RacePosition() const
{
	const FVector PP = PlayerPos();
	auto Prog = [&](int32 Cp, const FVector& L)
	{
		return Cp * 100000.f - (RouteCps.IsValidIndex(Cp) ? FVector2D::Distance(FVector2D(L) / SH::M, RouteCps[Cp]) : 0.f);
	};
	const float Me = Prog(CpIdx, PP);
	int32 Pos = 1;
	for (AActor* A : MissionActors)
		if (const ASHVehicle* V = Cast<ASHVehicle>(A))
			if (V->Mode == ESHDriveMode::Race && Prog(V->RaceIdx, V->GetActorLocation()) > Me) ++Pos;
	return Pos;
}

void ASHGameMode::StartMission(int32 Index)
{
	Active = Index;
	Stage = 0;
	MissionClock = 0.f;
	MissionTimer = -1.f;
	MissionCount = 0;
	Progress = 0.f;
	CpIdx = 0;
	const FSHMission& M = Missions[Index];
	ShowBig(M.Title, M.Color, 3.5f, M.City);
	Objective = M.Desc;
	for (ASHProp* P : MarkerProps) if (P) P->SetActorHiddenInGame(true);
	auto GiveCar = [&](ESHVehicleKind K, FVector2D P, float Yaw, const FLinearColor& Paint = FLinearColor(0.f, 0.f, 0.f, -1.f)) -> ASHVehicle*
	{
		if (PlayerVehicle) ExitVehicle(true);
		ASHVehicle* V = SpawnVehicle(K, P, Yaw, 0.f, Paint);
		if (!V) return nullptr;
		V->bMissionVehicle = true;
		MissionActors.Add(V);
		EnterVehicle(V, true);
		MissionCar = V;
		return V;
	};
	switch (M.Id)
	{
	case 0:
	{
		const int32 Route[][2] = { {4, 7}, {4, 3}, {7, 3}, {7, 1}, {2, 1}, {2, 5}, {0, 5}, {0, 7}, {3, 7} };
		RouteCps.Reset();
		for (const auto& R : Route) RouteCps.Add(NodePos(DALLAS.X, DALLAS.Y, R[0], R[1]));
		const float Z0 = DALLAS.Y + 300.f;
		GiveCar(ESHVehicleKind::Sports, FVector2D(-2440.f, Z0 + 3.f), 0.f, SH::Hex(TEXT("FF2A2A")));
		const ESHVehicleKind Kinds[] = { ESHVehicleKind::Sports, ESHVehicleKind::Muscle, ESHVehicleKind::Sports };
		const FVector2D Grid[] = { FVector2D(-2440.f, Z0 - 3.f), FVector2D(-2455.f, Z0 + 3.f), FVector2D(-2455.f, Z0 - 3.f) };
		for (int32 i = 0; i < 3; ++i)
		{
			ASHVehicle* R = SpawnVehicle(Kinds[i], Grid[i], 0.f);
			if (!R) continue;
			R->bMissionVehicle = true;
			R->MaxHealth = R->Health = R->MaxHealth * 3.f;
			R->Mode = ESHDriveMode::Parked;
			R->RaceCheckpoints = RouteCps;
			R->Skill = 0.88f + i * 0.035f;
			MissionActors.Add(R);
		}
		bWantedLocked = true;
		SetWanted(0);
		break;
	}
	case 1: GiveCar(ESHVehicleKind::Van, FVector2D(-250.f, 1504.5f), 0.f); break;
	case 2:
		if (PlayerChar) PlayerChar->GiveWeapon(ESHWeapon::Minigun, 3000);
		bWantedLocked = true;
		SetWanted(0);
		break;
	case 3:
		GiveCar(ESHVehicleKind::Monster, FVector2D(250.f, 1004.5f), 0.f);
		for (int32 K = 0; K < 10; ++K)
		{
			static const ESHVehicleKind Victims[] = { ESHVehicleKind::Sedan, ESHVehicleKind::Taxi, ESHVehicleKind::Muscle, ESHVehicleKind::Van };
			if (ASHVehicle* V = SpawnVehicle(Victims[K % 4], FVector2D(330.f + K * 14.f, 1000.f + (K % 2 ? -4.5f : 4.5f)), K % 2 ? 180.f : 0.f))
			{
				V->Mode = ESHDriveMode::Parked;
				MissionActors.Add(V);
			}
		}
		break;
	case 4: SetWanted(0); break;
	case 5:
		GiveCar(ESHVehicleKind::Heli, FVector2D(World->Safehouses.IsValidIndex(2) ? World->Safehouses[2].X + 12.f : ATL.X, ATL.Y + 300.f), 0.f);
		break;
	}
}

void ASHGameMode::EndMission(bool bPassed, const FString& Reason)
{
	if (Active < 0) return;
	const FSHMission& M = Missions[Active];
	if (bPassed)
	{
		Money += M.Reward;
		Completed.Add(M.Id);
		ShowBig(TEXT("MISSION PASSED"), SH::Hex(TEXT("F2C230")), 4.f, FString::Printf(TEXT("%s   +$%d"), *M.Title, M.Reward));
	}
	else ShowBig(TEXT("MISSION FAILED"), SH::Hex(TEXT("FF4B4B")), 4.f, Reason);
	for (AActor* A : MissionActors)
	{
		if (!A) continue;
		if (A == PlayerVehicle) { if (ASHVehicle* V = Cast<ASHVehicle>(A)) V->bMissionVehicle = false; continue; }
		if (ASHVehicle* V = Cast<ASHVehicle>(A)) Vehicles.Remove(V);
		if (ASHPed* P = Cast<ASHPed>(A)) Peds.Remove(P);
		A->Destroy();
	}
	for (ASHPed* P : Peds) if (P && P->bMissionHostile && P->IsAlive()) { P->bHostile = false; P->Scare(PlayerPos(), 20.f); }
	if (M.Id == 2 && PlayerChar) PlayerChar->Ammo[(int32)ESHWeapon::Minigun] = FMath::Min(PlayerChar->Ammo[(int32)ESHWeapon::Minigun], 300);
	MissionActors.Empty();
	MissionCar = nullptr;
	ClearCheckpoint();
	Active = -1;
	MissionTimer = -1.f;
	MissionCooldown = 6.f;
	bWantedLocked = false;
	Objective.Reset();
	for (ASHProp* P : MarkerProps) if (P) P->SetActorHiddenInGame(false);
}

void ASHGameMode::UpdateMissions(float Dt)
{
	const FVector PP = PlayerPos();
	const FVector2D PM(PP.X / SH::M, PP.Y / SH::M);
	if (Active < 0)
	{
		if (bPlayerDead || MissionCooldown > 0.f) return;
		for (int32 i = 0; i < Missions.Num(); ++i)
		{
			if (FVector2D::Distance(PM, Missions[i].Marker) < 3.2f && PP.Z < 400.f)
			{
				if (PlayerVehicle && Missions[i].Id != 5) { ShowHint(FString::Printf(TEXT("Get out of the vehicle to start: %s"), *Missions[i].Title)); continue; }
				StartMission(i);
				break;
			}
		}
		return;
	}
	const FSHMission& M = Missions[Active];
	MissionClock += Dt;
	if (Stage == 0)
	{
		if (MissionClock < 3.f) return;
		Stage = 1;
		switch (M.Id)
		{
		case 0:
			for (AActor* A : MissionActors) if (ASHVehicle* V = Cast<ASHVehicle>(A)) if (V != MissionCar) V->Mode = ESHDriveMode::Race;
			ShowBig(TEXT("GO!"), SH::Hex(TEXT("7FFF7F")), 1.2f);
			SetCheckpoint(RouteCps[0]);
			break;
		case 1: MissionTimer = 170.f; if (World->Safehouses.IsValidIndex(2)) SetCheckpoint(World->Safehouses[2]); break;
		case 2: MissionTimer = 80.f; break;
		case 3: MissionTimer = 110.f; break;
		case 4: SetCheckpoint(World->Bank - FVector2D(0, 4), 3.f); break;
		default: break;
		}
		return;
	}
	if (MissionTimer >= 0.f)
	{
		MissionTimer -= Dt;
		if (MissionTimer <= 0.f) { EndMission(false, TEXT("Out of time")); return; }
	}
	switch (M.Id)
	{
	case 0:
	{
		Objective = PlayerVehicle ? FString::Printf(TEXT("Race through the checkpoints: %d/%d   Position %d/4"), CpIdx, RouteCps.Num(), RacePosition()) : TEXT("Get back in a car!");
		if (RouteCps.IsValidIndex(CpIdx) && FVector2D::Distance(PM, RouteCps[CpIdx]) < 12.f)
		{
			++CpIdx;
			if (CpIdx >= RouteCps.Num())
			{
				const int32 Pos = RacePosition();
				EndMission(Pos == 1, FString::Printf(TEXT("You finished position %d"), Pos));
				return;
			}
			SetCheckpoint(RouteCps[CpIdx]);
		}
		for (AActor* A : MissionActors)
			if (ASHVehicle* V = Cast<ASHVehicle>(A))
				if (V->Mode == ESHDriveMode::Race) V->Rubber = V->RaceIdx > CpIdx ? 0.85f : V->RaceIdx < CpIdx ? 1.12f : 1.f;
		break;
	}
	case 1:
	{
		ASHVehicle* Van = MissionCar;
		if (!Van || Van->bDead) { EndMission(false, TEXT("The gumbo is ruined")); return; }
		const int32 Hp = FMath::RoundToInt(100.f * Van->Health / Van->MaxHealth);
		if (Hp < 25) { EndMission(false, TEXT("You spilled the gumbo")); return; }
		Objective = PlayerVehicle == Van ? FString::Printf(TEXT("Deliver the gumbo to the Atlanta safehouse. Gumbo integrity: %d%%"), Hp) : TEXT("Get back in the gumbo van!");
		if (PlayerVehicle == Van && FVector2D::Distance(PM, Gps) < 10.f) EndMission(true, FString());
		break;
	}
	case 2:
	{
		int32 Hostiles = 0;
		for (ASHPed* P : Peds) if (P && P->bMissionHostile && P->IsAlive()) ++Hostiles;
		if (Hostiles < 14 && FMath::FRand() < Dt * 2.f)
		{
			const float A = FMath::FRandRange(0.f, 2.f * PI), R = FMath::FRandRange(25.f, 55.f);
			FActorSpawnParameters SP;
			SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
			if (ASHPed* G = GetWorld()->SpawnActor<ASHPed>(ASHPed::StaticClass(), PP + FVector(FMath::Cos(A) * R * SH::M, FMath::Sin(A) * R * SH::M, 100.f), FRotator::ZeroRotator, SP))
			{
				G->Init(ESHPedKind::Gang, -1, 2, SH::Hex(TEXT("C0392B")));
				G->bHostile = true; G->bMissionHostile = true; G->State = ESHPedState::Attack;
				Peds.Add(G);
			}
		}
		Objective = FString::Printf(TEXT("RAMPAGE! Kill 35: %d/35"), MissionCount);
		if (MissionCount >= 35) EndMission(true, FString());
		break;
	}
	case 3:
		Objective = PlayerVehicle && PlayerVehicle->Kind == ESHVehicleKind::Monster ? FString::Printf(TEXT("Crush cars! %d/10"), MissionCount) : TEXT("Get back in the Mardi Monster!");
		if (MissionCount >= 10) EndMission(true, FString());
		break;
	case 4:
	{
		const FVector2D Vault = World->Bank - FVector2D(0, 4);
		if (Stage == 1)
		{
			if (FVector2D::Distance(PM, Vault) < 3.5f)
			{
				Progress += Dt;
				Objective = FString::Printf(TEXT("Cracking the vault... %d%%"), FMath::Min(100, FMath::RoundToInt(Progress / 6.f * 100.f)));
				if (Progress >= 6.f)
				{
					Progress = 0.f;
					Stage = 2;
					ReportCrime(ESHCrime::Heist, PP);
					if (ASHVehicle* Car = SpawnVehicle(ESHVehicleKind::Muscle, World->Bank + FVector2D(12.f, 10.f), 0.f, 0.f, SH::Hex(TEXT("111111")))) { Car->bMissionVehicle = true; MissionActors.Add(Car); }
					if (World->Safehouses.IsValidIndex(1)) SetCheckpoint(World->Safehouses[1]);
					ShowBig(TEXT("YOU GOT THE CASH"), SH::Hex(TEXT("3DFF6A")), 2.f);
					for (int32 K = 0; K < 4; ++K)
					{
						FActorSpawnParameters SP;
						SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
						if (ASHPed* C = GetWorld()->SpawnActor<ASHPed>(ASHPed::StaticClass(), SH::W(World->Bank.X + FMath::FRandRange(-12.f, 12.f), World->Bank.Y + FMath::FRandRange(4.f, 10.f), 1.3f), FRotator::ZeroRotator, SP))
						{
							C->Init(K < 2 ? ESHPedKind::Swat : ESHPedKind::Cop, -1, 0, FLinearColor::Blue);
							C->State = ESHPedState::Attack;
							Peds.Add(C);
						}
					}
				}
			}
			else Objective = TEXT("Stand at the Federal Reserve entrance to crack the vault");
		}
		else
		{
			Objective = TEXT("Get the cash to the New Orleans safehouse!");
			if (FVector2D::Distance(PM, Gps) < 10.f) { SetWanted(0); EndMission(true, FString()); }
		}
		break;
	}
	case 5:
	{
		const FVector2D Target(ATL.X + 50.f, ATL.Y + 185.f);
		const float Alt = PP.Z / SH::M;
		if (Stage == 1)
		{
			Objective = FString::Printf(TEXT("Climb to 500m. Altitude: %dm"), FMath::RoundToInt(Alt));
			if ((!PlayerVehicle || !PlayerVehicle->Def->bHeli) && Alt < 50.f) { EndMission(false, TEXT("You need the helicopter")); return; }
			if (Alt > 500.f) Stage = 2;
		}
		else if (Stage == 2)
		{
			Objective = TEXT("BAIL OUT! Press F, then SPACE to open your parachute");
			if (!PlayerVehicle) { Stage = 3; SetCheckpoint(Target, 16.f); }
		}
		else
		{
			Objective = FString::Printf(TEXT("Land on the Capitol lawn: %dm away"), FMath::RoundToInt(FVector2D::Distance(PM, Target)));
			const bool bLanded = PlayerVehicle || (PlayerChar && !PlayerChar->GetCharacterMovement()->IsFalling());
			if (bLanded) EndMission(FVector2D::Distance(PM, Target) < 25.f, TEXT("You missed the landing zone"));
		}
		break;
	}
	default: break;
	}
}
